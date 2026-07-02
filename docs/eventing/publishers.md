---
id: publishers
title: Publishing Events
sidebar_label: Publishers
---

# Publishing Events

The **publish** side of NRSRx eventing is built around one small interface,
`IPublisher<TEntity, TEvent>`. You inject it, call `PublishAsync(entity)`, and the
framework serializes the entity and writes it to the configured transport (Redis Streams or
Azure Service Bus).

- **Abstraction:** `IkeMtz.NRSRx.Events.Abstraction`
- **Redis:** `IkeMtz.NRSRx.Events.Publishers.Redis`
- **Azure Service Bus:** `IkeMtz.NRSRx.Events.Publishers.ServiceBus`

## The interface

```csharp
public interface IPublisher<TEntity, TEvent>
  where TEntity : IIdentifiable<Guid>
  where TEvent  : EventType, new()
{
  Task PublishAsync(TEntity payload);
}
```

- `TEntity` — the thing you're publishing (must implement [`IIdentifiable`](../data/models-and-interfaces.md#iidentifiable)).
- `TEvent` — the [event type](./overview.md#events-are-entity--verb) verb
  (`CreatedEvent`, `UpdatedEvent`, `DeletedEvent`, …).

A non-`Guid` key variant, `IPublisher<TEntity, TEvent, TKey>`, exists for entities keyed
by something other than a `Guid`.

## Using a publisher in a controller

Inject the publisher for the specific entity+event pairing you want to emit:

```csharp
[Route("api/v{version:apiVersion}/[controller].{format}"), FormatFilter]
[ApiVersion(VersionDefinitions.v1_0)]
[ApiController]
[Authorize]
public class SchoolsController : ControllerBase
{
  [HttpPost]
  [ValidateModel]
  public async Task<ActionResult> Post(
      [FromBody] SchoolUpsertRequest request,
      [FromServices] IPublisher<School, CreatedEvent> publisher)
  {
    var value = SimpleMapper<SchoolUpsertRequest, School>.Instance.Convert(request);
    value.Id = request.Id;
    await publisher.PublishAsync(value);
    return Ok();
  }

  [HttpPut]
  [ValidateModel]
  public async Task<ActionResult> Put(
      [FromQuery] Guid id,
      [FromBody] SchoolUpsertRequest request,
      [FromServices] IPublisher<School, UpdatedEvent> publisher)
  {
    var value = SimpleMapper<SchoolUpsertRequest, School>.Instance.Convert(request);
    value.Id = id;
    await publisher.PublishAsync(value);
    return Ok();
  }

  [HttpDelete]
  public async Task<ActionResult> Delete(
      [FromQuery] Guid id,
      [FromServices] IPublisher<School, DeletedEvent> publisher)
  {
    await publisher.PublishAsync(new School { Id = id });
    return Ok();
  }
}
```

## Registering publishers — Redis

Override `SetupPublishers` in your `Startup`. Call `AddRedisStreamPublisher<TEntity, TEvent>`
for each entity+event combination you publish:

```csharp
public override void SetupPublishers(IServiceCollection services)
{
  var redis = ConnectionMultiplexer.Connect(
      Configuration.GetValue<string>("REDIS_CONNECTION_STRING"));
  services.AddSingleton<IConnectionMultiplexer>(redis);

  services.AddRedisStreamPublisher<School, CreatedEvent>();
  services.AddRedisStreamPublisher<School, UpdatedEvent>();
  services.AddRedisStreamPublisher<School, DeletedEvent>();
}
```

For large payloads (see below), also register the split-message publisher:

```csharp
services.AddRedisStreamSplitMessagePublisher<School, UpdatedEvent>();
```

## Registering publishers — Azure Service Bus

Swap `AddRedisStreamPublisher` for `AddServiceBusQueuePublishers`. The Service Bus helper
registers all three event types (`Created`, `Updated`, `Deleted`) in a single call:

```csharp
public override void SetupPublishers(IServiceCollection services)
{
  // Registers School + CreatedEvent, School + UpdatedEvent, School + DeletedEvent.
  services.AddServiceBusQueuePublishers<School>();
}
```

Your controllers are **unchanged** — they still inject
`IPublisher<School, CreatedEvent>` etc. Only the registration line differs.

### Connection string naming for Service Bus

`ServiceBusQueuePublisher` reads the connection string from configuration. The key is
derived from the entity name and event suffix with dashes removed, followed by `QueConnStr`:

```
{EntityName}{EventSuffix}QueConnStr
```

Examples:

| Publisher | Configuration key |
| --- | --- |
| `IPublisher<School, CreatedEvent>` | `SchoolCreatedQueConnStr` |
| `IPublisher<School, UpdatedEvent>` | `SchoolUpdatedQueConnStr` |
| `IPublisher<School, DeletedEvent>` | `SchoolDeletedQueConnStr` |

Set these in `appsettings.json` or as environment variables:

```json
{
  "SchoolCreatedQueConnStr": "Endpoint=sb://...",
  "SchoolUpdatedQueConnStr": "Endpoint=sb://...",
  "SchoolDeletedQueConnStr": "Endpoint=sb://..."
}
```

If a connection string is missing, `ConnectionStringMissingException` is thrown at
startup — intentional fail-fast behavior.

## Stream / topic naming

NRSRx derives the destination name from the entity type and the event suffix:

```
{EntityName}{EventSuffix}
→  School + CreatedEvent (suffix "Created") → SchoolCreated stream/queue
```

Subscribers listen on the same derived name, which is how producers and consumers
rendezvous without hard-coding strings on both sides.

## Large payloads: SplitMessage&lt;T&gt;

For payloads too large for a single message, publish a `SplitMessage<T>` instead. The
abstraction tracks the total number of chunks (`TaskCount`) so the subscriber side knows
when all chunks have arrived.

```csharp
// Publisher side: send a large School as N chunks.
var splitPublisher = services.GetRequiredService<
    IPublisher<SplitMessage<School>, UpdatedEvent>>();

var chunks = BuildChunks(largeSchool, chunkSize: 10);
foreach (var chunk in chunks)
{
    await splitPublisher.PublishAsync(new SplitMessage<School>
    {
        Id        = largeSchool.Id,
        TaskCount = chunks.Count,
        Payload   = chunk,
    });
}
```

On the subscriber side, use `SplitMessageFunction<TFunction, TEntity, TEvent>` (from
`IkeMtz.NRSRx.Jobs.Redis`) which tracks `Passed`/`Failed` counts and calls
`NotifySplitCompletion` automatically when all chunks are processed. See
[Jobs & Subscribers](./jobs.md#large-messages) for the full subscriber example.

## Publish, then what?

Publishing is fire-and-forget from the producer's perspective. The consuming side — a
long-running background **job** that subscribes to the stream and handles each message —
is covered next in [Jobs & Subscribers](./jobs.md).
