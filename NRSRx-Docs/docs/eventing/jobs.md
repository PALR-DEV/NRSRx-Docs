---
id: jobs
title: Jobs & Subscribers
sidebar_label: Jobs & Subscribers
---

# Jobs & Subscribers

Where [publishers](./publishers.md) emit events, **jobs** consume them. A NRSRx job is a
long-running background worker (a console app / hosted service) made of one or more
**functions**, each of which processes work — most often by subscribing to a message
stream.

- **Core:** `IkeMtz.NRSRx.Jobs.Core` (the `JobBase` host and function model)
- **Redis subscribers:** `IkeMtz.NRSRx.Jobs.Redis` + `IkeMtz.NRSRx.Events.Subscribers.Redis`
- **Scheduled jobs:** `IkeMtz.NRSRx.Jobs.Cron`
- **Job logging:** `IkeMtz.NRSRx.Jobs.Logging.Splunk`

## Anatomy of a job

A job has two parts:

1. **A `Program` that extends `JobBase<TProgram>`** — the host. It sets up dependencies,
   logging, and registers functions, then runs them on a loop.
2. **One or more functions** — the units of work. For event consumption, these extend
   `MessageFunction<…>`.

### The host: `JobBase<TProgram>`

```csharp
public class Program : JobBase<Program>, IJob
{
  public ConnectionMultiplexer RedisConnectionMultiplexer { get; private set; }
  public override string? HealthFileLocation => "health.txt";

  public static async Task Main()
  {
    var prog = new Program
    {
      RunContinuously = false,   // run once and exit (true = loop forever)
      SecsBetweenRuns = 15,      // sleep between iterations when continuous
    };
    await prog.RunAsync();
  }

  public override IServiceCollection SetupFunctions(IServiceCollection services) =>
    services
      .AddFunction<SchoolCreatedFunction>()
      .AddFunction<SchoolUpdatedSplitFunction>();

  public override IServiceCollection SetupDependencies(IServiceCollection services)
  {
    var connStr = Configuration.GetValue<string>("REDIS_CONNECTION_STRING");
    RedisConnectionMultiplexer = ConnectionMultiplexer.Connect(connStr);

    return services
      .AddSingleton(_ => new RedisStreamSubscriber<School, CreatedEvent>(
        RedisConnectionMultiplexer, new RedisSubscriberOptions
        {
          StartPosition = StreamPosition.Beginning,
          IdleTimeSpanInMilliseconds = 1000,
          MaxMessageProcessRetry = 5000,
        }))
      .AddSingleton(_ => new RedisStreamSubscriber<SplitMessage<School>, UpdatedEvent>(
        RedisConnectionMultiplexer, new RedisSubscriberOptions
        {
          StartPosition = StreamPosition.Beginning,
          IdleTimeSpanInMilliseconds = 1000,
          MaxMessageProcessRetry = 5000,
        }));
  }

  public override void SetupLogging(IServiceCollection services) =>
    this.SetupSplunk(services);
}
```

### A function: `MessageFunction<…>`

A message function binds an entity + event + subscriber, and you implement
`HandleMessageAsync` with what to do per message:

```csharp
public class SchoolCreatedFunction
  : MessageFunction<SchoolCreatedFunction, School, CreatedEvent>
{
  public SchoolCreatedFunction(
      ILogger<SchoolCreatedFunction> logger,
      RedisStreamSubscriber<School, CreatedEvent> subscriber)
    : base(logger, subscriber)
  {
    this.EnablePendingMsgProcessing = true; // drain previously-pending messages
    this.MessageBufferCount = 100;          // how many to pull per batch
  }

  public override Task<bool> HandleMessageAsync(School entity)
  {
    Logger.LogInformation("Sample handled.");
    // ...update local data, call downstream, etc.
    return Task.FromResult(true);           // true = ack/success
  }
}
```

Returning `true` acknowledges the message as processed; returning `false` (or throwing)
lets it be retried up to `MaxMessageProcessRetry`.

## How `JobBase` runs

`RunAsync` builds a Generic Host, resolves the registered functions, and executes them:

- Functions run in **sequence priority** order (highest `SequencePriority` first), or in
  parallel if `EnableParallelFunctionProcessing` is `true`.
- If `RunContinuously` is `true`, the job loops forever, sleeping `SecsBetweenRuns`
  (default `60`, configurable via the `SecsBetweenRuns` config key) between iterations.
  If `false`, it runs each function once and exits.
- Each function runs in its **own DI scope**, with structured-logging scopes and timing
  around it, and exceptions are caught and logged (a failing function doesn't crash the
  whole job).
- On a successful pass, if `HealthFileLocation` is set, the job writes a timestamp to that
  file — a simple **liveness probe** for containers.

### Key `JobBase` members

| Member | Default | Purpose |
| --- | --- | --- |
| `RunContinuously` | `true` | Loop forever vs. run once. |
| `SecsBetweenRuns` | `60` (config) | Sleep between iterations. |
| `EnableParallelFunctionProcessing` | `false` | Run functions in parallel. |
| `HealthFileLocation` | `null` | Path to write a liveness timestamp. |
| `SetupFunctions` (abstract) | — | Register your functions. |
| `SetupDependencies` (virtual) | adds `TimeProvider` | Register subscribers/services. |
| `SetupLogging` (virtual) | no-op | Wire a logging sink. |
| `SetupUserProvider` (virtual) | no-op | Register `SystemUserProvider` for non-HTTP auditing. |

## Redis subscriber options

`RedisSubscriberOptions` tunes how the subscriber reads a stream:

| Option | Meaning |
| --- | --- |
| `StartPosition` | Where to begin reading (`Beginning`, or new messages only). |
| `IdleTimeSpanInMilliseconds` | How long to wait when the stream is idle. |
| `MaxMessageProcessRetry` | How many times to retry a failing message before giving up. |

## Large messages: SplitMessageFunction

When a publisher sends a `SplitMessage<T>` (a large entity chunked across multiple
messages), use `SplitMessageFunction<TSelf, TEntity, TEvent>` (from `IkeMtz.NRSRx.Jobs.Redis`)
on the subscriber side.

`SplitMessageFunction` extends `MessageFunction` and adds fan-out tracking: it uses Redis
to count `Passed` and `Failed` chunks, and calls `NotifySplitCompletion` automatically
once all chunks (`TaskCount`) have been processed.

```csharp
public class SchoolUpdatedSplitFunction
  : SplitMessageFunction<SchoolUpdatedSplitFunction, School, UpdatedEvent>
{
  public SchoolUpdatedSplitFunction(
      ILogger<SchoolUpdatedSplitFunction> logger,
      RedisStreamSubscriber<SplitMessage<School>, UpdatedEvent> subscriber)
    : base(logger, subscriber)
  {
    AutoDeleteSplitProgressData = true; // clean up Redis progress keys when done
  }

  public override Task<bool> HandleMessageAsync(SplitMessage<School> entity)
  {
    // Process one chunk. entity.Payload is the partial School data.
    Logger.LogInformation("Processing chunk for School {Id}", entity.Id);
    return Task.FromResult(true);
  }

  // Called once all chunks for a given entity have been processed.
  public override Task NotifySplitCompletion(SplitMessage<School> entity)
  {
    Logger.LogInformation("All chunks for School {Id} processed", entity.Id);
    return Task.CompletedTask;
  }
}
```

Key members of `SplitMessageFunction`:

| Member | Default | Purpose |
| --- | --- | --- |
| `AutoDeleteSplitProgressData` | `true` | Delete Redis progress keys when all chunks complete. |
| `NotifySplitCompletion(entity)` | no-op | Override to act when all chunks are done. |
| `NotifySplitProgress(entity, isSuccess)` | (automatic) | Called per chunk; updates Redis counters. |

## Scheduled (cron) jobs

Not every job is event-driven. For time-based work, use `IkeMtz.NRSRx.Jobs.Cron` to run
a function on a schedule rather than subscribing to a stream. See the full guide at
[Scheduled (Cron) Jobs](./cron-jobs.md).
