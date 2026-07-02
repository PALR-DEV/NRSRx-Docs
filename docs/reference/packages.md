---
id: packages
title: Package Reference
sidebar_label: Packages
---

# Package Reference

NRSRx is distributed as a family of NuGet packages under the **`IkeMtz.NRSRx.*`** prefix.
You only reference the ones you need. All are published to
[NuGet](https://www.nuget.org/packages?q=nrsrx).

## Core / Web

| Package | Purpose |
| --- | --- |
| `IkeMtz.NRSRx.Core.Models` | The model interfaces (`IIdentifiable`, `IAuditable`, `ICalculateable`, `IEnableable`, `IDeletable`, `ITentantable`, `IEnumValue`), `SimpleMapper`, `ODataEnvelope`, `ICurrentUserProvider`, and validation attributes. The most foundational package. |
| `IkeMtz.NRSRx.Core.Web` | The shared `CoreWebStartup` base: configuration, JWT auth, Swagger, app settings, the HTTP user provider, validation attributes (`ValidateModel`, `ValidateMatchingId`), and the tenant filter. |
| `IkeMtz.NRSRx.Core.WebApi` | The `CoreWebApiStartup` base for REST controller services. |
| `IkeMtz.NRSRx.Core.OData` | The `CoreODataStartup` base and `BaseODataModelProvider` for queryable OData services. |
| `IkeMtz.NRSRx.Core.SignalR` | The `CoreSignalrStartup` base for real-time hub services. |
| `IkeMtz.NRSRx.Core.EntityFramework` | `AuditableDbContext`, batch saving, and collection syncing for EF Core. |
| `IkeMtz.NRSRx.Core.Jwt` | JWT helpers. |
| `IkeMtz.NRSRx.Core.Authorization` | Authorization building blocks. |
| `IkeMtz.NRSRx.Core.Unigration` | "Unigration" test base classes & helpers for web services. |

## Eventing

| Package | Purpose |
| --- | --- |
| `IkeMtz.NRSRx.Events.Abstraction` | The transport-agnostic contracts: `IPublisher<…>`, `EventType` and its subtypes (`CreatedEvent`, `UpdatedEvent`, …), `SplitMessage<T>`, message coding. |
| `IkeMtz.NRSRx.Events.Publishers.Redis` | Publish events to **Redis Streams**. |
| `IkeMtz.NRSRx.Events.Publishers.ServiceBus` | Publish events to **Azure Service Bus**. |
| `IkeMtz.NRSRx.Events.Subscribers.Redis` | Subscribe to **Redis Streams** (`RedisStreamSubscriber<…>`). |

## Jobs (background workers)

| Package | Purpose |
| --- | --- |
| `IkeMtz.NRSRx.Jobs.Core` | The `JobBase<TProgram>` host, the function contracts (`IFunction`, `IMessageFunction`), and `AddFunction<T>()`. |
| `IkeMtz.NRSRx.Jobs.Redis` | Redis-backed message function base classes (`MessageFunction`, `SplitMessageFunction`) for consuming event streams. |
| `IkeMtz.NRSRx.Jobs.Cron` | Schedule jobs to run on a cron-style timetable. |
| `IkeMtz.NRSRx.Jobs.Logging.Splunk` | Splunk logging for jobs. |
| `IkeMtz.NRSRx.Jobs.Unigration` | Unigration testing for jobs. |

## Logging

| Package | Purpose |
| --- | --- |
| `IkeMtz.NRSRx.Logging.ApplicationInsights` | Log to Azure Application Insights. |
| `IkeMtz.NRSRx.Logging.Elasticsearch` | Log to Elasticsearch. |
| `IkeMtz.NRSRx.Logging.Splunk` | Log to Splunk. |
| `IkeMtz.NRSRx.Unigration.Logging` | Capture/assert logs in tests. |

## Choosing packages by scenario

| I'm building… | Reference |
| --- | --- |
| A REST write API with a database | `Core.WebApi` + `Core.EntityFramework` + a SQL provider |
| A queryable read API | `Core.OData` + `Core.EntityFramework` + a SQL provider |
| A real-time hub | `Core.SignalR` |
| An API that emits events | the above + `Events.Publishers.Redis` *or* `Events.Publishers.ServiceBus` |
| A worker that consumes events | `Jobs.Core` + `Jobs.Redis` + `Events.Subscribers.Redis` |
| A scheduled worker | `Jobs.Core` + `Jobs.Cron` |
| Tests | `Core.Unigration` (+ `Jobs.Unigration` for jobs) |
| Logging | one of the `Logging.*` packages |

`Core.Models` comes along transitively with the flavor packages, but you'll often
reference it directly in your Models project.

## Installing

```bash
dotnet add package IkeMtz.NRSRx.Core.WebApi
dotnet add package IkeMtz.NRSRx.Core.EntityFramework
dotnet add package IkeMtz.NRSRx.Events.Publishers.Redis
```

All packages share a synchronized version number, so keep the `IkeMtz.NRSRx.*` references
in a solution on the **same version**.
