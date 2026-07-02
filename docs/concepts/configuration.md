---
id: configuration
title: Configuration
sidebar_label: Configuration
---

# Configuration

NRSRx uses the standard ASP.NET configuration system, which **layers** sources so that
later sources override earlier ones. This lets the same build run unchanged across
developer machines, CI, and production.

## Configuration sources (in order)

1. **`appsettings.json`** holds committed defaults and non-secret settings.
2. **`appsettings.{Environment}.json`** holds per-environment overrides.
3. **User Secrets** keep secrets *out* of source control during local development.
4. **Environment variables** are the preferred source in containers and cloud platforms.

Because environment variables win, you can ship one image and configure it entirely through
the environment, which is the twelve-factor approach.

## Strongly-typed settings: AppSettings

During `SetupAppSettings`, the configuration is bound to an `AppSettings` object and
registered for injection:

```csharp
public virtual void SetupAppSettings(IServiceCollection services)
{
  SetupCurrentUserProvider(services)
    .Configure<AppSettings>(Configuration)
    .AddScoped(sp => sp.GetRequiredService<IOptionsSnapshot<AppSettings>>().Value);
}
```

You can inject `AppSettings` into any controller or service to read configuration in a
typed way, rather than reaching into `IConfiguration` with string keys.

## Core framework keys

These are the configuration keys the framework itself reads:

| Key | Used by | Purpose |
| --- | --- | --- |
| `DbConnectionString` | `SetupDatabase` | The connection string passed to your DbContext setup. |
| `IdentityProvider` | Authentication | The OIDC authority URL used to validate JWTs (e.g. `https://login.example.com/`). |
| `IdentityAudiences` | Authentication | Comma-separated list of valid token audiences. |
| `DisableSwagger` | `Configure` | When `true`, Swagger UI and JSON are not served. |
| `SwaggerClientId` | Swagger UI | OAuth client id used by the Swagger "Authorize" button. |
| `SwaggerClientSecret` | Swagger UI | OAuth client secret (for confidential clients). |
| `SwaggerAppName` | Swagger UI | Display name for the Swagger OAuth app. |
| `swaggerReverseProxyBasePath` | `ReverseProxyDocumentFilter` | When set, this base path is prepended to every path in the generated Swagger document — use it when the service sits behind a reverse proxy that adds a path prefix. |

## Eventing and jobs keys

| Key | Used by | Purpose |
| --- | --- | --- |
| `REDIS_CONNECTION_STRING` | Redis publishers and subscribers | StackExchange.Redis connection string. |
| `SecsBetweenRuns` | `JobBase` | Seconds to sleep between job iterations (default `60`). |
| `{Entity}{Event}QueConnStr` | Service Bus publishers | Per-publisher Azure Service Bus connection strings (e.g., `SchoolCreatedQueConnStr`). See [Publishers](../eventing/publishers.md#connection-string-naming-for-service-bus). |

## Logging sink keys

Each logging sink reads its own environment-variable-style keys. Reference these when
configuring deployments.

### Application Insights

| Key | Required | Purpose |
| --- | --- | --- |
| `InstrumentationConnectionString` | ✅ | Application Insights connection string (from the Azure portal). |

### Elasticsearch

| Key | Required | Purpose |
| --- | --- | --- |
| `ELASTICSEARCH_HOST` | ✅ | Elasticsearch URL (e.g., `http://localhost:9200`). |
| `ELASTICSEARCH_USERNAME` | For basic / API key auth | Username or API key token `id`. |
| `ELASTICSEARCH_PASSWORD` | For basic auth | Password. |
| `ELASTICSEARCH_APIKEY` | For API key auth | The `api_key` value. |
| `ELASTICSEARCH_DISABLE_SSL_VALIDATION` | | `true` to skip SSL validation (dev only). |
| `ELASTICSEARCH_VERSION` | | `6.x` to target Elasticsearch v6; defaults to v7. |
| `ENVIRONMENT_NAME` | | Included in index names and log entries. |

### Splunk

| Key | Required | Purpose |
| --- | --- | --- |
| `SPLUNK_HOST` | ✅ | Splunk HTTP Event Collector (HEC) endpoint URL. |
| `SPLUNK_TOKEN` | ✅ | HEC authentication token. |
| `SPLUNK_DISABLE_SSL_VALIDATION` | | `true` to skip SSL validation (dev only). |
| `SPLUNK_URI_PATH` | | HEC URI path. Default: `services/collector/event`. |
| `SPLUNK_INDEX` | | Splunk index. Default: empty (uses the token's default). |
| `SPLUNK_SOURCE_TYPE` | | Source type for events. Default: empty. |
| `ENVIRONMENT_NAME` | | Included in log entries. |

See [Logging](../logging/overview.md) for full details on each sink.

## Integration test keys

When running integration tests against a real identity server (vs. the in-memory unigration
setup), the framework reads these additional keys:

| Key | Purpose |
| --- | --- |
| `IntegrationTestClientId` | OAuth client id for obtaining a real token. |
| `IntegrationTestClientSecret` | OAuth client secret. |
| `IntegrationTestTokenUrl` | Token endpoint URL (e.g., `https://login.example.com/oauth/token`). |

These are read by `BaseUnigrationTests.GenerateTokenAsync()` and are only needed for true
integration tests that hit a live identity server.

## Example appsettings.json

```json
{
  "DbConnectionString": "Server=(localdb)\\mssqllocaldb;Database=MyService;Trusted_Connection=True;",
  "IdentityProvider": "https://login.example.com/",
  "IdentityAudiences": "my-service-api,my-service-admin",
  "SwaggerClientId": "my-service-swagger",
  "SwaggerAppName": "My Service",
  "DisableSwagger": false,
  "REDIS_CONNECTION_STRING": "localhost:6379"
}
```

## Reading configuration in your Startup

`Configuration` is available as a property on every NRSRx startup:

```csharp
public override void SetupDatabase(IServiceCollection services, string connectionString)
{
  // connectionString is already pulled from Configuration["DbConnectionString"]
  services.AddDbContext<DatabaseContext>(x => x.UseSqlServer(connectionString));

  // Need another value? Read it directly:
  var featureFlag = Configuration.GetValue<bool>("EnableExperimentalFeature");
}
```

## Tips

* Use **User Secrets** locally for `DbConnectionString` and any OAuth secrets so they
  never land in git.
* In Kubernetes and containers, map secrets to environment variables named after the keys
  above.
* Keep `DisableSwagger` driven by config so you can turn docs off per environment without
  recompiling.
* `DOTNET_ENVIRONMENT` / `ASPNETCORE_ENVIRONMENT` control which `appsettings.{Env}.json`
  file is loaded. The test framework forces `Development` so developer-friendly settings
  (e.g., `UseDeveloperExceptionPage`) are active during unigration tests.
