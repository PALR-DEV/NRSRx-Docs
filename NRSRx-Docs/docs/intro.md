---
id: intro
title: What is NRSRx?
sidebar_label: Introduction
sidebar_position: 1
slug: /
---

# What is NRSRx?

**NRSRx** is an opinionated, flexible, and extensible framework that accelerates the
development of **back-end services on ASP.NET (versions 6 through 9)**.

It exists to solve a frustrating reality of microservice development. Before you write a
single line of *business* logic, every service needs the same plumbing: configuration,
authentication, authorization, Swagger docs, database access, auditing, versioning,
logging, health checks, and eventing. Rebuilding that plumbing for every service is slow,
error prone, and inconsistent.

NRSRx ships that plumbing as a set of small, composable NuGet packages. You inherit from a
base `Startup` class, override the few methods that are specific to your service, and the
framework wires up the rest.

:::tip The one-sentence summary
You write a controller and a model, and NRSRx gives you a fully configured, authenticated,
versioned, documented, audited, observable microservice around it.
:::

---

## Why it exists

Building microservices well means solving the same **cross-cutting concerns** over and
over. NRSRx handles these out of the box so you can focus on your domain:

| Concern | What NRSRx provides |
| --- | --- |
| **Configuration** | `appsettings.json`, User Secrets, and environment variables, layered automatically. |
| **Authentication** | JWT bearer authentication (OAuth2 and OIDC), pre-wired. |
| **Authorization** | Role-based authorization via ASP.NET request filters. |
| **API documentation** | Swagger and OpenAPI, configured as an OIDC client so you can log in and try endpoints. |
| **Data persistence** | Entity Framework Core with automatic entity auditing. |
| **Multi-tenancy** | A request authorization filter to scope data to a tenant. |
| **Versioning** | API and model versioning that follows Microsoft's REST guidelines. |
| **Logging** | Application Insights, Elasticsearch, or Splunk via drop-in packages. |
| **Eventing** | Publish and subscribe over Azure Service Bus or Redis Streams. |
| **Testability** | "Unigration" test base classes. NRSRx services routinely hit 95%+ coverage. |

These are explained in detail under [Core Concepts](./concepts/architecture.md).

---

## How it works (the 30-second version)

A NRSRx service is a normal ASP.NET application with two small twists.

First, **`Program.cs`** uses a one-line bootstrapper that builds the host from your
`Startup`.

```csharp
public static class Program
{
  public static void Main() =>
    CoreWebStartup.CreateDefaultHostBuilder<Startup>()
      .UseLogging()
      .Build()
      .Run();
}
```

Second, **`Startup.cs`** inherits from a framework base class (`CoreWebApiStartup`,
`CoreODataStartup`, or `CoreSignalrStartup`) and overrides only what's unique to your
service, such as the database, logging sink, and health checks.

```csharp
public class Startup : CoreWebApiStartup
{
  public override string ServiceTitle => "Samples WebApi Microservice";
  public override Assembly StartupAssembly => typeof(Startup).Assembly;

  public Startup(IConfiguration configuration) : base(configuration) { }

  public override void SetupDatabase(IServiceCollection services, string connectionString) =>
    services.AddDbContext<DatabaseContext>(x => x.UseSqlServer(connectionString));

  public override void SetupHealthChecks(IServiceCollection services, IHealthChecksBuilder checks) =>
    checks.AddDbContextCheck<DatabaseContext>();
}
```

That's it. The base class's `ConfigureServices` and `Configure` methods then assemble the
full pipeline: app settings, logging, Swagger, the database, health checks, event
publishers, JWT authentication, API versioning, and controller routing. Each step is a
`virtual` method you can override or replace. See
[The Startup Pipeline](./concepts/architecture.md) for the exact sequence.

---

## The three flavors

NRSRx services come in three "flavors," each with its own base `Startup` class and NuGet
package. Pick the one that fits the job.

* **[WebApi](./flavors/webapi.md)** handles classic REST controllers for creating and
  persisting domain state (POST/PUT/DELETE with validation and auditing).
* **[OData](./flavors/odata.md)** exposes rich, queryable read endpoints (`$filter`,
  `$select`, `$expand`, `$top`) backed by Entity Framework.
* **[SignalR](./flavors/signalr.md)** powers real-time, push-based hubs for notifications
  and live updates.

> A GraphQL flavor is listed as "coming soon" in the project README.

---

## Design philosophy

> **Nothing in NRSRx is `private`, `internal`, or `sealed`.**

Every feature is built from `virtual` methods on base classes. If you don't want a feature,
override the method and remove it. If you need to change behavior, override it and call (or
skip) `base`. This is what the project means by *adaptable*. The framework gives you
sensible defaults without locking you in.

---

## Where to go next

* **[Getting Started](./getting-started.md)** walks you through building your first NRSRx
  service step by step.
* **[Core Concepts: Architecture](./concepts/architecture.md)** explains the startup
  pipeline in depth.
* **[Service Flavors: Overview](./flavors/overview.md)** helps you choose the right flavor.
* **[Reference: Packages](./reference/packages.md)** lists every NuGet package.
