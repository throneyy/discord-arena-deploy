/**
 * discord_arena.sp
 * SourceMod plugin — sends match results to the Discord Arena API.
 *
 * Requires: sm-ripext (https://github.com/ErikMinekus/sm-ripext)
 *
 * Build:
 *   spcomp discord_arena.sp -o discord_arena.smx
 *
 * Install:
 *   Place discord_arena.smx in addons/sourcemod/plugins/
 *   Place discord_arena.cfg in cfg/sourcemod/
 *
 * Before each match set the match ID via RCON:
 *   rcon da_match_id "clxxxxxxxxxxxxxxxxxx"
 */

#include <sourcemod>
#include <ripext>

#pragma semicolon 1
#pragma newdecls required

// ───────────────────────────────────────────────────────────────────
PluginInfo g_Plugin =
{
  name        = "Discord Arena",
  author      = "arena-dev",
  description = "Sends match results to Discord Arena API",
  version     = "1.0.0",
  url         = ""
};

// ───────────────────────────────────────────────────────────────────
ConVar g_cvApiUrl;
ConVar g_cvHmacSecret;
ConVar g_cvMatchId;

char g_sApiUrl[256];
char g_sHmacSecret[128];
char g_sMatchId[64];

// ───────────────────────────────────────────────────────────────────
public void OnPluginStart()
{
  g_cvApiUrl     = CreateConVar("da_api_url",    "",  "Discord Arena API base URL",  FCVAR_PROTECTED);
  g_cvHmacSecret = CreateConVar("da_hmac_secret","",  "HMAC secret (matches Node.js)", FCVAR_PROTECTED);
  g_cvMatchId    = CreateConVar("da_match_id",   "",  "Current match ID",             0);

  AutoExecConfig(true, "discord_arena");

  HookEventEx("cs_win_panel_match", Event_MatchEnd, EventHookMode_PostNoCopy);
  HookEventEx("tf_game_over",       Event_MatchEnd, EventHookMode_PostNoCopy);

  RegAdminCmd("da_test_result", Cmd_TestResult, ADMFLAG_ROOT, "Test: simulate a match result");
}

// ───────────────────────────────────────────────────────────────────
public Action Event_MatchEnd(Event event, const char[] name, bool dontBroadcast)
{
  g_cvMatchId.GetString(g_sMatchId, sizeof(g_sMatchId));
  if (strlen(g_sMatchId) == 0) {
    LogMessage("[DiscordArena] da_match_id is not set — skipping result post");
    return Plugin_Continue;
  }

  // Find the winning team (CT=3, T=2 in CS2; use score to compare for TF2)
  char winnerDiscordId[64];
  winnerDiscordId[0] = '\0';

  // Walk all connected clients, find the one whose team won with max score
  int   bestScore = -1;
  for (int i = 1; i <= MaxClients; i++) {
    if (!IsClientConnected(i) || IsClientBot(i)) continue;

    char steamId[64];
    GetClientAuthId(i, AuthId_Steam2, steamId, sizeof(steamId));

    // Use client frags as a proxy; real integrations would check team score
    int score = GetClientFrags(i);
    if (score > bestScore) {
      bestScore = score;
      // In production store the Discord ID in a client cookie / name prefix
      GetClientName(i, winnerDiscordId, sizeof(winnerDiscordId));
    }
  }

  if (strlen(winnerDiscordId) == 0) {
    LogMessage("[DiscordArena] Could not determine winner — skipping");
    return Plugin_Continue;
  }

  SendResult(g_sMatchId, winnerDiscordId);
  return Plugin_Continue;
}

// ───────────────────────────────────────────────────────────────────
public Action Cmd_TestResult(int client, int args)
{
  char matchId[64], winnerId[64];
  GetCmdArg(1, matchId,  sizeof(matchId));
  GetCmdArg(2, winnerId, sizeof(winnerId));

  if (strlen(matchId) == 0 || strlen(winnerId) == 0) {
    ReplyToCommand(client, "Usage: da_test_result <matchId> <winnerDiscordId>");
    return Plugin_Handled;
  }

  SendResult(matchId, winnerId);
  ReplyToCommand(client, "[DiscordArena] Test result dispatched.");
  return Plugin_Handled;
}

// ───────────────────────────────────────────────────────────────────
void SendResult(const char[] matchId, const char[] winnerDiscordId)
{
  g_cvApiUrl.GetString(g_sApiUrl, sizeof(g_sApiUrl));
  g_cvHmacSecret.GetString(g_sHmacSecret, sizeof(g_sHmacSecret));

  if (strlen(g_sApiUrl) == 0 || strlen(g_sHmacSecret) == 0) {
    LogError("[DiscordArena] da_api_url or da_hmac_secret is not configured");
    return;
  }

  // Build JSON body
  char ts[32];
  IntToString(GetTime() * 1000, ts, sizeof(ts));

  char body[512];
  Format(body, sizeof(body),
    "{\"matchId\":\"%s\",\"winnerDiscordId\":\"%s\",\"timestamp\":%s}",
    matchId, winnerDiscordId, ts
  );

  // Compute HMAC-SHA256 signature
  // sm-ripext provides HMAC via CryptoGenerateHMACSHA256
  char signature[65]; // 64 hex chars + null
  if (!CryptoGenerateHMACSHA256(g_sHmacSecret, body, signature, sizeof(signature))) {
    LogError("[DiscordArena] Failed to compute HMAC");
    return;
  }

  // Build full URL
  char url[300];
  Format(url, sizeof(url), "%s/api/match-result", g_sApiUrl);

  // Fire HTTP POST
  HTTPRequest req = new HTTPRequest(url);
  req.SetHeader("Content-Type",         "application/json");
  req.SetHeader("X-Signature-Sha256",   signature);
  req.POST(body, OnResultResponse, 0);
}

// ───────────────────────────────────────────────────────────────────
public void OnResultResponse(HTTPResponse response, any value)
{
  if (response.Status != HTTPStatus_OK) {
    LogError("[DiscordArena] API returned HTTP %d", response.Status);
    return;
  }
  LogMessage("[DiscordArena] Match result posted successfully");
}
