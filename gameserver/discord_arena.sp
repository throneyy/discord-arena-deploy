/**
 * discord_arena.sp — SourceMod plugin for Discord Arena
 *
 * Fires a HMAC-signed POST to the Discord Arena API when a match ends.
 * Requires: sm-ripext (https://github.com/ErikMinekus/sm-ripext)
 *
 * Compile: spcomp discord_arena.sp -o discord_arena.smx
 * Install: addons/sourcemod/plugins/discord_arena.smx
 */

#include <sourcemod>
#include <ripext>

#pragma semicolon 1
#pragma newdecls required

// ── ConVars ──
ConVar g_cvApiUrl;
ConVar g_cvHmacSecret;
ConVar g_cvMatchId;

// ── Plugin Info ──
public Plugin myinfo = {
  name        = "Discord Arena",
  author      = "Arena",
  description = "Posts match results to Discord Arena API",
  version     = "1.0.0",
  url         = ""
};

public void OnPluginStart() {
  g_cvApiUrl     = CreateConVar("da_api_url",    "",  "Discord Arena API base URL");
  g_cvHmacSecret = CreateConVar("da_hmac_secret", "", "HMAC-SHA256 shared secret",   FCVAR_PROTECTED);
  g_cvMatchId    = CreateConVar("da_match_id",   "",  "Current match ID (set via RCON before each match)");

  AutoExecConfig(true, "discord_arena");

  HookEvent("cs_win_panel_match", Event_MatchEnd);
  // For TF2, swap to: HookEvent("teamplay_win_panel", Event_MatchEnd);

  LogMessage("[DiscordArena] Plugin loaded.");
}

// ──────────────────────────────────────────────────────────────────────────────
// Event_MatchEnd — fired when a CS2 match ends
// ──────────────────────────────────────────────────────────────────────────────
public Action Event_MatchEnd(Event event, const char[] name, bool dontBroadcast) {
  char matchId[128];
  g_cvMatchId.GetString(matchId, sizeof(matchId));

  if (matchId[0] == '\0') {
    LogMessage("[DiscordArena] da_match_id not set — skipping result post.");
    return Plugin_Continue;
  }

  // Determine winner by team score
  int t_score  = event.GetInt("t_score");
  int ct_score = event.GetInt("ct_score");

  // Find the winning team's MVP (highest score)
  int winTeam = (ct_score >= t_score) ? CS_TEAM_CT : CS_TEAM_T;
  int winner  = FindTopScorerOnTeam(winTeam);

  if (winner == -1) {
    LogMessage("[DiscordArena] Could not determine winner.");
    return Plugin_Continue;
  }

  char winnerSteamId[64];
  GetClientAuthId(winner, AuthId_SteamID64, winnerSteamId, sizeof(winnerSteamId));

  PostMatchResult(matchId, winnerSteamId);
  return Plugin_Continue;
}

// ──────────────────────────────────────────────────────────────────────────────
// FindTopScorerOnTeam — returns client index of highest-score player on team
// ──────────────────────────────────────────────────────────────────────────────
int FindTopScorerOnTeam(int team) {
  int best = -1;
  int bestScore = -1;

  for (int i = 1; i <= MaxClients; i++) {
    if (!IsClientInGame(i) || IsClientObserver(i)) continue;
    if (GetClientTeam(i) != team) continue;

    int score = GetClientFrags(i);
    if (score > bestScore) {
      bestScore = score;
      best      = i;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────────
// PostMatchResult — builds JSON payload, signs with HMAC, POSTs to API
// ──────────────────────────────────────────────────────────────────────────────
void PostMatchResult(const char[] matchId, const char[] winnerDiscordId) {
  char apiUrl[256];
  char hmacSecret[256];
  g_cvApiUrl.GetString(apiUrl, sizeof(apiUrl));
  g_cvHmacSecret.GetString(hmacSecret, sizeof(hmacSecret));

  if (apiUrl[0] == '\0' || hmacSecret[0] == '\0') {
    LogError("[DiscordArena] da_api_url or da_hmac_secret not configured.");
    return;
  }

  // Build timestamp
  int timestamp = GetTime() * 1000; // ms epoch

  // Build JSON body
  char body[512];
  FormatEx(body, sizeof(body),
    "{\"matchId\":\"%s\",\"winnerDiscordId\":\"%s\",\"timestamp\":%d}",
    matchId, winnerDiscordId, timestamp
  );

  // Compute HMAC-SHA256 (ripext provides HMAC utilities)
  char signature[65]; // 32 bytes = 64 hex chars
  ripext_hmac_sha256(hmacSecret, body, signature, sizeof(signature));

  // POST to API
  char endpoint[512];
  FormatEx(endpoint, sizeof(endpoint), "%s/api/match-result", apiUrl);

  HTTPRequest request = new HTTPRequest(endpoint);
  request.SetHeader("Content-Type",  "application/json");
  request.SetHeader("x-signature",   signature);

  JSONObject json = JSONObject.FromString(body);
  request.Post(json, OnMatchResultResponse);
  delete json;

  LogMessage("[DiscordArena] Posted match result: match=%s winner=%s", matchId, winnerDiscordId);
}

// ──────────────────────────────────────────────────────────────────────────────
// OnMatchResultResponse — callback for HTTP POST
// ──────────────────────────────────────────────────────────────────────────────
public void OnMatchResultResponse(HTTPResponse response, any value) {
  if (response.Status != HTTPStatus_OK) {
    LogError("[DiscordArena] API error: HTTP %d", response.Status);
    return;
  }
  LogMessage("[DiscordArena] Match result accepted by API.");
}
