---
id: cron-jobs
title: Scheduled (Cron) Jobs
sidebar_label: Cron Jobs
---

# Scheduled (Cron) Jobs

Not every job is event-driven. For time-based work — nightly recalculations, cleanup,
report generation, health pings — use `IkeMtz.NRSRx.Jobs.Cron` to run a function on a
schedule rather than subscribing to a message stream.

- **Package:** `IkeMtz.NRSRx.Jobs.Cron`
- **Test doubles:** `IkeMtz.NRSRx.Jobs.Unigration` (`MockCronJobStateProvider`, `FakeTimeProvider`)

## How cron jobs work

A cron function runs inside the same `JobBase` host as a message function. The difference
is that instead of pulling from a Redis stream, `CronFunction<TFunction>` checks the
current time against a cron schedule and decides whether to run.

The schedule and last-run state are persisted via `ICronJobStateProvider`. The included
implementation, `FileCronJobStateProvider`, stores the state as a JSON file on disk.

## Defining a cron function

Extend `CronFunction<TFunction>` and implement:
- `CronExpression` — a standard crontab expression.
- `ExecuteAsync()` — the logic that runs on schedule.

```csharp
using IkeMtz.NRSRx.Jobs.Cron;
using Microsoft.Extensions.Logging;

public class NightlyReportFunction : CronFunction<NightlyReportFunction>
{
  private readonly ReportService _reports;

  public NightlyReportFunction(
      ILogger<CronFunction<NightlyReportFunction>> logger,
      TimeProvider timeProvider,
      ICronJobStateProvider cronJobStateProvider,
      ReportService reports)
    : base(logger, timeProvider, cronJobStateProvider)
  {
    _reports = reports;
    ExecuteOnStartup = false; // don't run immediately on first start
  }

  // Standard crontab syntax: "At 02:00 every day"
  // Visit https://crontab.guru/ for help building expressions.
  public override string CronExpression { get; set; } = "0 2 * * *";

  public override async Task<bool> ExecuteAsync()
  {
    Logger.LogInformation("Generating nightly report");
    await _reports.GenerateAsync();
    return true;
  }
}
```

### CronExpression format

NRSRx uses the [NCrontab](https://github.com/atifaziz/NCrontab) library, which follows
the standard 5-field crontab format:

```
┌─────── minute (0–59)
│ ┌───── hour (0–23)
│ │ ┌─── day of month (1–31)
│ │ │ ┌─ month (1–12)
│ │ │ │ ┌ day of week (0–6, Sunday=0)
│ │ │ │ │
* * * * *
```

| Expression | Meaning |
| --- | --- |
| `0 2 * * *` | Daily at 02:00 UTC |
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1` | Every Monday at 09:00 UTC |
| `0 0 1 * *` | First day of every month at midnight UTC |

Use [crontab.guru](https://crontab.guru/) to build and verify expressions interactively.

## ExecuteOnStartup

Set `ExecuteOnStartup = true` in the constructor to run the function immediately when the
job starts, regardless of the schedule. After the first run, normal schedule logic applies.

```csharp
ExecuteOnStartup = true; // run once at startup, then follow the schedule
```

## CronJobState

`CronJobState` holds the scheduler's memory between runs:

```csharp
public class CronJobState
{
  public DateTimeOffset? LastRunDateTimeUtc { get; set; }
  public DateTimeOffset? NextRunDateTimeUtc { get; set; }
}
```

`CronFunction.RunAsync()` reads and updates this state via `ICronJobStateProvider` on
every job iteration.

## ICronJobStateProvider

```csharp
public interface ICronJobStateProvider
{
  Task<CronJobState> GetCronJobStateAsync<TCronFunction>() where TCronFunction : class;
  Task<CronJobState> UpdateCronJobStateAsync<TCronFunction>(DateTimeOffset nextExecutionDateTimeUtc) where TCronFunction : class;
}
```

State is keyed by function type, so multiple cron functions in the same job maintain
independent schedules.

### FileCronJobStateProvider

The included implementation stores state in `{FunctionName}.state.json` files under a
configurable directory:

```csharp
public override IServiceCollection SetupDependencies(IServiceCollection services)
{
  return services
    .AddSingleton<ICronJobStateProvider>(new FileCronJobStateProvider(
        cronJobStateDirectory: new DirectoryInfo("/var/cron-state"),
        timeProvider: TimeProvider.System));
}
```

If the directory doesn't exist, it is created automatically. Each function gets its own
file: e.g., `NightlyReportFunction.state.json`.

## Registering a cron function

Register the function in `SetupFunctions` and its dependencies in `SetupDependencies`:

```csharp
public class Program : JobBase<Program>, IJob
{
  public static async Task Main() =>
    await new Program { RunContinuously = true, SecsBetweenRuns = 60 }.RunAsync();

  public override IServiceCollection SetupFunctions(IServiceCollection services) =>
    services.AddFunction<NightlyReportFunction>();

  public override IServiceCollection SetupDependencies(IServiceCollection services) =>
    services
      .AddSingleton<ICronJobStateProvider>(new FileCronJobStateProvider(
          new DirectoryInfo("/var/cron-state"), TimeProvider.System))
      .AddScoped<ReportService>();

  public override void SetupLogging(IServiceCollection services) =>
    this.SetupSplunk(services);
}
```

With `RunContinuously = true` and `SecsBetweenRuns = 60`, the job wakes up every minute,
checks whether the cron function is due, and runs it if so. Functions that are not yet due
are skipped silently.

## Testing cron functions

Inject `MockCronJobStateProvider` (from `IkeMtz.NRSRx.Jobs.Unigration`) and
`FakeTimeProvider` (from `IkeMtz.NRSRx.Core.Unigration.Fakes`) to control scheduling
in tests:

```csharp
[TestMethod]
public async Task NightlyReport_ExecutesAndReturnsTrue()
{
  // FakeTimeProvider lets you set the "current time" to any value.
  var fakeTime = new FakeTimeProvider(DateTimeOffset.UtcNow);

  // MockCronJobStateProvider returns a state where NextRunDateTimeUtc is yesterday,
  // so the function always believes it is due to run.
  var mockState = new MockCronJobStateProvider(fakeTime);

  var function = new NightlyReportFunction(
      logger: NullLogger<CronFunction<NightlyReportFunction>>.Instance,
      timeProvider: fakeTime,
      cronJobStateProvider: mockState,
      reports: new FakeReportService());

  var result = await function.RunAsync();

  Assert.IsTrue(result);
  // Verify whatever side-effects ExecuteAsync should produce.
}
```

`MockCronJobStateProvider` sets:
- `LastRunDateTimeUtc` = 180 days ago
- `NextRunDateTimeUtc` = yesterday

This guarantees the function runs without you having to manipulate real file state.

## Combining cron and message functions

A single job can mix cron functions and message functions. Register them all in
`SetupFunctions`. They run in `SequencePriority` order (cron functions default to priority
`100`):

```csharp
public override IServiceCollection SetupFunctions(IServiceCollection services) =>
  services
    .AddFunction<SchoolCreatedFunction>()   // message function
    .AddFunction<NightlyReportFunction>();  // cron function
```
