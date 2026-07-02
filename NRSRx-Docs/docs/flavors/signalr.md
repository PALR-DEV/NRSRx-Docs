---
id: signalr
title: SignalR Flavor
sidebar_label: SignalR
---

# SignalR Flavor

The SignalR flavor is for **real-time, push-based communication**. The server pushes
messages to connected clients over a persistent connection (WebSockets, with fallbacks).
Use it for notifications, live dashboards, chat, presence, and progress updates.

* **Package:** `IkeMtz.NRSRx.Core.SignalR`
* **Base class:** `CoreSignalrStartup`

## The Startup

A SignalR startup is the simplest of the three. You override `MapHubs` to register your
hub endpoints:

```csharp
public class Startup : CoreSignalrStartup
{
  public override Assembly StartupAssembly => typeof(Startup).Assembly;

  public Startup(IConfiguration configuration) : base(configuration) { }

  public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
    this.SetupApplicationInsights(services);

  public override void MapHubs(IEndpointRouteBuilder endpoints)
  {
    endpoints.MapHub<NotificationHub>("/notificationHub");
  }
}
```

:::note Differences from WebApi/OData
`CoreSignalrStartup` does **not** call `SetupSwagger` or `SetupPublishers` — there is no
Swagger UI in a SignalR service, and publishers are not part of the base SignalR pipeline.
Add them in `SetupMiscDependencies` if your hub also needs to publish events.
:::

The base class provides the shared `CoreWebStartup` machinery (configuration, JWT
authentication, and health checks), so your hubs are authenticated the same way your APIs
are.

## Hubs

A hub is a standard SignalR `Hub`. Decorate it with `[Authorize]` so only authenticated
clients can connect:

```csharp
[Authorize]
public class NotificationHub : Hub
{
  // Broadcast to every connected client.
  public Task SendMessage(string message) =>
    Clients.All.SendAsync("OnMessageReceived",
      $"{Context.User?.Identity?.Name} - {message}");

  // Send to one specific user (by their user id / name claim).
  public Task SendUserMessage(string receiver, string message) =>
    Clients.User(receiver).SendAsync("OnMessageReceived",
      $"{Context.User?.Identity?.Name} - {message}");
}
```

## UserIdProvider — how Clients.User(id) works

`Clients.User(id)` routes a message to all connections for a given user. For this to work,
SignalR needs to know how to extract the user id from a connection. `CoreSignalrStartup`
registers `UserIdProvider` (from `IkeMtz.NRSRx.Core.SignalR`) as the `IUserIdProvider`,
which reads the `sub` claim by default:

```csharp
public class UserIdProvider : IUserIdProvider
{
  public static string UserIdClaimType { get; set; } = "sub";

  public string? GetUserId(HubConnectionContext connection)
  {
    return connection.User?.FindFirst(UserIdClaimType)?.Value;
  }
}
```

If your identity provider uses a different claim for the user id (e.g., `oid` in Azure AD),
change `UserIdClaimType` before the server starts — typically in `Program.cs`:

```csharp
// Change the claim type used to identify users in SignalR.
UserIdProvider.UserIdClaimType = "oid";
```

Or override `SetupUserIdProvider` in your `Startup` to replace the provider entirely:

```csharp
public override void SetupUserIdProvider(IServiceCollection services)
{
  services.AddSingleton<IUserIdProvider, MyCustomUserIdProvider>();
}
```

## Client targeting cheatsheet

| Call | Sends to |
| --- | --- |
| `Clients.All` | Every connected client. |
| `Clients.Caller` | Just the client that invoked the hub method. |
| `Clients.Others` | Everyone except the caller. |
| `Clients.User(id)` | All connections for a specific user id (resolved via `UserIdProvider`). |
| `Clients.Group(name)` | All members of a group. |

## A common architecture

SignalR services shine as the "last mile" of an event-driven system:

```
WebApi service        →  publishes "SchoolUpdated" event  →  Redis / Service Bus
                                                                    │
Background Job (subscriber)  ◄──────────────────────────────────────┘
        │  handles the event
        ▼
SignalR Hub  ──pushes "OnMessageReceived"──►  connected browsers / apps
```

The WebApi service stays decoupled (it just publishes an event), a
[background job](../eventing/jobs.md) subscribes, and the SignalR hub pushes the update to
clients in real time. See [Eventing: Overview](../eventing/overview.md).

## Notes

* SignalR uses WebSockets when available, so make sure your reverse proxy or gateway
  allows WebSocket upgrades on the hub path.
* Authenticating WebSocket connections typically requires passing the access token as a
  query-string parameter (`access_token`), because browsers can't set headers on the
  WebSocket handshake. `CoreSignalrStartup.SetupAuthentication` already handles this: it
  reads `access_token` from the query string on the hub path automatically.
* For unigration testing, use `CoreSignalrUnigrationTestStartup<TStartup>` and the
  `BuildSignalrConnection(srv, hubEndpoint, accessToken)` extension method.
  See [Unigration Testing](../testing/unigration.md#testing-signalr-hubs).
