---
id: overview
title: Logging
sidebar_label: Logging
---

# Logging

NRSRx treats logging as a **pluggable sink**: you write standard `ILogger` calls in your
code, and pick where the logs *go* with a single `Setup*` call in your `Startup`. Three
sinks are supported out of the box.

| Sink | Package | Enable with |
| --- | --- | --- |
| **Application Insights** | `IkeMtz.NRSRx.Logging.ApplicationInsights` | `this.SetupApplicationInsights(services)` |
| **Elasticsearch** | `IkeMtz.NRSRx.Logging.Elasticsearch` | `this.SetupElasticsearch(app)` |
| **Splunk** | `IkeMtz.NRSRx.Logging.Splunk` | `this.SetupSplunk(services)` |

There's also `IkeMtz.NRSRx.Jobs.Logging.Splunk` for the [jobs](../eventing/jobs.md) host,
and `IkeMtz.NRSRx.Unigration.Logging` for capturing logs in
[tests](../testing/unigration.md).

## Wiring a sink in a web service

`SetupLogging` is a `virtual` no-op on the base startup; override it and call the
extension method for your chosen sink. It is invoked twice by the pipeline — once during
service registration (`services` is non-null) and once during pipeline configuration
(`app` is non-null) — so each sink reads whichever argument it needs.

```csharp
// Elasticsearch (needs the app builder)
public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
  this.SetupElasticsearch(app);

// Application Insights (needs the service collection)
public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
  this.SetupApplicationInsights(services);
```

## Enabling logging in `Program.cs`

The logging packages add a `.UseLogging()` extension to the host builder. Call it before
`Build()`:

```csharp
CoreWebStartup.CreateDefaultHostBuilder<Startup>()
  .UseLogging()
  .Build()
  .Run();
```

## Logging in a job

Jobs have their own `SetupLogging(IServiceCollection)` override on `JobBase`:

```csharp
public override void SetupLogging(IServiceCollection services) =>
  this.SetupSplunk(services);
```

## Writing logs

Use the standard `ILogger<T>` everywhere — inject it into controllers, services, and
functions. NRSRx's own helpers cooperate with it; for example,
`AuditableDbContext.SaveChangesAsync(logger)` logs the affected row count:

```csharp
public class CoursesController(DatabaseContext db, ILogger<CoursesController> logger)
  : ControllerBase
{
  [HttpPost]
  public async Task<ActionResult> Post([FromBody] CourseUpsertRequest request)
  {
    logger.LogInformation("Creating course {Title}", request.Title);
    var entry = db.Courses.Add(/* ... */);
    await db.SaveChangesAsync(logger);  // logs the row count
    return Ok(entry.Entity);
  }
}
```

Prefer **structured logging** (message templates with named placeholders like
`{Title}`) over string interpolation, so your sink can index and query the properties.

---

## Application Insights

**Package:** `IkeMtz.NRSRx.Logging.ApplicationInsights`

```csharp
public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
  this.SetupApplicationInsights(services);
```

For local development, `SetupDevelopmentApplicationInsights` enables `DeveloperMode` and
`EnableDebugLogger` so telemetry appears immediately in the output window without batching:

```csharp
#if DEBUG
  this.SetupDevelopmentApplicationInsights(services);
#else
  this.SetupApplicationInsights(services);
#endif
```

### Configuration keys

| Key | Required | Purpose |
| --- | --- | --- |
| `InstrumentationConnectionString` | ✅ | The Application Insights connection string (from the Azure portal). |

---

## Elasticsearch

**Package:** `IkeMtz.NRSRx.Logging.Elasticsearch`

```csharp
public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
  this.SetupElasticsearch(app);
```

:::note Version support
This package supports Elasticsearch **v6.x and v7.x** only. Set `ELASTICSEARCH_VERSION`
to `6.x` to target v6; anything else defaults to v7.
:::

Logs are written to an index named:
```
{assembly-name}-{ENVIRONMENT_NAME}-{yy-MM}
```
For example: `my-service-development-26-06`.

### Configuration keys

| Key | Required | Purpose |
| --- | --- | --- |
| `ELASTICSEARCH_HOST` | ✅ | URL of the Elasticsearch endpoint, e.g. `http://localhost:9200`. |
| `ELASTICSEARCH_USERNAME` | For basic auth | Username. Also used as the token `id` for API key auth. |
| `ELASTICSEARCH_PASSWORD` | For basic auth | Password. |
| `ELASTICSEARCH_APIKEY` | For API key auth | The `api_key` value of your API key token. |
| `ELASTICSEARCH_DISABLE_SSL_VALIDATION` | | Set `true` to skip certificate validation (dev only). |
| `ELASTICSEARCH_VERSION` | | Set `6.x` to target Elasticsearch v6; defaults to v7. |
| `ENVIRONMENT_NAME` | | Included in the index name and log entries to distinguish environments. |

---

## Splunk

**Package:** `IkeMtz.NRSRx.Logging.Splunk` (web) and `IkeMtz.NRSRx.Jobs.Logging.Splunk` (jobs)

```csharp
// Web service
public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
  this.SetupSplunk(services);

// Job
public override void SetupLogging(IServiceCollection services) =>
  this.SetupSplunk(services);
```

### Configuration keys

| Key | Required | Purpose |
| --- | --- | --- |
| `SPLUNK_HOST` | ✅ | The Splunk HTTP Event Collector (HEC) endpoint URL. |
| `SPLUNK_TOKEN` | ✅ | Authentication token for the Splunk HEC. |
| `SPLUNK_DISABLE_SSL_VALIDATION` | | Set `true` to skip SSL validation (dev only). Default: `false`. |
| `SPLUNK_URI_PATH` | | HEC URI path. Default: `services/collector/event`. |
| `SPLUNK_INDEX` | | Splunk index to send events to. Default: empty (uses the token's default index). |
| `SPLUNK_SOURCE_TYPE` | | Source type for events. Default: empty. |
| `ENVIRONMENT_NAME` | | Included in log entries to distinguish environments. |

---

## Choosing a sink

| If you're on… | Use |
| --- | --- |
| Azure | Application Insights |
| The Elastic / ELK stack | Elasticsearch |
| Splunk | Splunk |

Because the sink is just an override, you can use different sinks per environment, or swap
sinks later without touching your application code.

---

## Test logging

`IkeMtz.NRSRx.Unigration.Logging` routes `ILogger` output and HTTP call logs to the MSTest
output window during unigration tests. It is wired automatically when you use
`TestWebHostBuilder` and `srv.CreateClient(TestContext)` — no configuration needed. See
[Test Helpers Reference](../testing/test-helpers-reference.md) for details on
`TestContextLogger`, `TestContextLoggerProvider`, and `HttpClientLoggingHandler`.
