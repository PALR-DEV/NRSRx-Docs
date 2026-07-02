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
- `TEvent` — the [event type](./overview.md#events-are-entity-plus-verb) verb
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

Override `SetupPublishers` in your `Startup` and register a `RedisStreamPublisher` for
each entity+event combination you publish (there is no registration extension method for
Redis — this is the pattern the samples use):

```csharp
public override void SetupPublishers(IServiceCollection services)
{
  var redis = ConnectionMultiplexer.Connect(
      Configuration.GetValue<string>("REDIS_CONNECTION_STRING"));

  services.AddSingleton<IPublisher<School, CreatedEvent>>(
      x => new RedisStreamPublisher<School, CreatedEvent>(redis));
  services.AddSingleton<IPublisher<School, UpdatedEvent>>(
      x => new RedisStreamPublisher<School, UpdatedEvent>(redis));
  services.AddSingleton<IPublisher<School, DeletedEvent>>(
      x => new RedisStreamPublisher<School, DeletedEvent>(redis));
}
```

For large workloads (see below), register the split-message publisher the same way:

```csharp
services.AddSingleton<IPublisher<SplitMessage<School>, UpdatedEvent>>(
    x => new RedisStreamSplitMessagePublisher<School, UpdatedEvent>(redis));
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

If a connection string is missing, `ConnectionStringMissingException` is thrown when the
publisher is constructed (on first resolution from DI) — intentional fail-fast behavior.

## Stream / queue naming

NRSRx derives the destination name from the entity type and the event suffix — but the
exact format differs by transport:

| Transport | Format | `School` + `CreatedEvent` |
| --- | --- | --- |
| Redis Streams | `{EntityName}:{EventSuffix}` (colon-separated) | `School:Created` |
| Azure Service Bus | `{EntityName}{EventSuffix}` (concatenated) | `SchoolCreated` |

For generic payloads like `SplitMessage<School>`, the Redis key expands to
`{InnerEntity}:{GenericTypeName}:{EventSuffix}` — e.g. `School:SplitMessage:Created`.

Subscribers derive the same name from the same type parameters, which is how producers and
consumers rendezvous without hard-coding strings on both sides.

## Large payloads: SplitMessage&lt;T&gt;

When one event should fan out into many independently-processed messages (one per entity),
publish `SplitMessage<T>` messages. Each message carries one `Entity` plus batch metadata:
a shared `Id` (the batch/task id — the *same* `Guid` for every message in the batch),
`TaskName`, `TaskCount` (total messages in the batch), and `QueuedBy`. The subscriber side
uses `TaskCount` to know when the whole batch has been processed.

Use the static `FromCollection` factory to build the batch:

```csharp
// Publisher side: fan a collection of Schools out as individual messages.
var splitPublisher = serviceProvider.GetRequiredService<
    IPublisher<SplitMessage<School>, UpdatedEvent>>();

var messages = SplitMessage<School>.FromCollection(
    schools,                      // IEnumerable<School>
    taskName: "school-refresh",
    userName: "import-service");  // becomes QueuedBy

foreach (var message in messages)
{
    await splitPublisher.PublishAsync(message);
}
```

On the subscriber side, use `SplitMessageFunction<TFunction, TEntity, TEvent>` (from
`IkeMtz.NRSRx.Jobs.Redis`) which tracks `Passed`/`Failed` counts and calls
`NotifySplitCompletion` automatically when all chunks are processed. See
[Jobs & Subscribers](./jobs.md#large-messages-splitmessagefunction) for the full
subscriber example.

## Publish, then what?

Publishing is fire-and-forget from the producer's perspective. The consuming side — a
long-running background **job** that subscribes to the stream and handles each message —
is covered next in [Jobs & Subscribers](./jobs.md).
