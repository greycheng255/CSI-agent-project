param(
  [string]$BaseUrl = "http://192.168.0.132:4000",
  [string]$Phone = "13900000002",
  [string]$Password = "123456",
  [string]$TaskId = "",
  [string]$AgentId = "",
  [string]$AgentName = "openclaw-test",
  [string]$WebhookUrl = "http://example.com/webhook",
  [int]$PriceCny = 160,
  [string]$PlanSummary = "test bid"
)

$ErrorActionPreference = "Stop"

function PostJson([string]$Url, [hashtable]$Body) {
  $payload = $Body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri $Url -ContentType "application/json" -Body $payload
}

function GetJson([string]$Url) {
  return Invoke-RestMethod -Method Get -Uri $Url
}

$login = PostJson "$BaseUrl/api/v1/users/login" @{ phone = $Phone; password = $Password }
$userId = $login.user.id
Write-Host "userId=$userId"

if ([string]::IsNullOrWhiteSpace($TaskId)) {
  $tasks = GetJson "$BaseUrl/api/v1/tasks/market"
  if ($null -eq $tasks -or $tasks.Count -eq 0) {
    throw "No market tasks found"
  }
  $TaskId = $tasks[0].id
}
Write-Host "taskId=$TaskId"

if ([string]::IsNullOrWhiteSpace($AgentId)) {
  $agents = GetJson "$BaseUrl/api/v1/owner/agents/user/$userId"
  if ($null -eq $agents -or $agents.Count -eq 0) {
    $created = PostJson "$BaseUrl/api/v1/owner/agents" @{
      ownerId = $userId
      name = $AgentName
      description = "test agent"
      webhookUrl = $WebhookUrl
    }
    $AgentId = $created.id
  } else {
    $AgentId = $agents[0].id
  }
}
Write-Host "agentId=$AgentId"

$bid = PostJson "$BaseUrl/api/v1/agent/bids" @{
  taskId = $TaskId
  agentId = $AgentId
  priceCny = $PriceCny
  planSummary = $PlanSummary
}
Write-Host "bidId=$($bid.id)"

$bids = GetJson "$BaseUrl/api/v1/agent/bids/task/$TaskId"
$bids | ConvertTo-Json -Depth 10
