---
id: architecture
title: Architecture & The Startup Pipeline
sidebar_label: Architecture
---

# Architecture & The Startup Pipeline

Everything in an NRSRx service hangs off a **base `Startup` class**. Understanding what
that base class does, and in what order, is the key to understanding the whole framework.

## The class hierarchy

```
CoreWebStartup                 (IkeMtz.NRSRx.Core.Web)
│   the shared foundation: config, auth, swagger, app settings, user provider
│
├── CoreWebApiStartup          (IkeMtz.NRSRx.Core.WebApi)   → REST controllers
├── CoreODataStartup           (IkeMtz.NRSRx.Core.OData)    → queryable OData endpoints
└── CoreSignalrStartup         (IkeMtz.NRSRx.Core.SignalR)  → real-time hubs
```

`CoreWebStartup` is an `abstract` base that holds the cross-cutting machinery every flavor
shares. Each flavor's base class extends it and adds the bits unique to that style of
service: controller routing for WebApi, the EDM model for OData, and hub mapping for
SignalR.

Your own `Startup` inherits from one of the three flavors.

## Two entry points: ConfigureServices and Configure

ASP.NET calls two methods on a startup class. NRSRx implements both for you in the flavor
base class, so you only override the *virtual building blocks* they call.

### ConfigureServices registers everything

For the WebApi flavor, `CoreWebApiStartup.ConfigureServices` runs this exact sequence:

```csharp
public void ConfigureServices(IServiceCollection services)
{
  SetupAppSettings(services);                       // 1
  SetupLogging(services);                            // 2
  SetupSwagger(services);                            // 3
  SetupDatabase(services, Configuration             // 4
      .GetValue<string>("DbConnectionString"));
  var healthChecks = services.AddHealthChecks();     // 5
  SetupHealthChecks(services, healthChecks);
  SetupPublishers(services);                         // 6
  SetupAuthentication(SetupJwtAuthSchema(services)); // 7
  SetupMiscDependencies(services);                   // 8
  var mvcBuilder = SetupCoreEndpointFunctionality(services); // 9
  if (StartupAssembly != null)
    mvcBuilder.AddApplicationPart(StartupAssembly);
  mvcBuilder.AddControllersAsServices();
  services.AddControllers();
}
```

| Step | Method | What it does | Override to |
| --- | --- | --- | --- |
| 1 | `SetupAppSettings` | Binds `AppSettings`, registers `ICurrentUserProvider`. | Add config-driven services. |
| 2 | `SetupLogging` | No-op by default. A logging package fills it in. | Choose App Insights, Elastic, or Splunk. |
| 3 | `SetupSwagger` | Registers Swagger gen and OIDC options. | Customize Swagger. |
| 4 | `SetupDatabase` | **You implement this** to register your DbContext. | Wire up EF and a provider. |
| 5 | `SetupHealthChecks` | Adds the health-check builder. | Add `AddDbContextCheck` and friends. |
| 6 | `SetupPublishers` | No-op by default. | Register event publishers. |
| 7 | `SetupAuthentication` | JWT bearer against your OIDC authority. | Change token validation. |
| 8 | `SetupMiscDependencies` | Hook for anything else. | Register your services. |
| 9 | `SetupCoreEndpointFunctionality` | MVC, Newtonsoft JSON, API versioning, XML formatters. | Tweak MVC options via `SetupMvcOptions`. |

Every one of those methods is `virtual`. The one in **bold** (`SetupDatabase`) is the one
you'll almost always override. The rest have working defaults.

### Configure builds the HTTP pipeline

```csharp
public virtual void Configure(IApplicationBuilder app, IWebHostEnvironment env,
    IApiVersionDescriptionProvider provider)
{
  if (env.IsDevelopment())
    app.UseDeveloperExceptionPage();
  else
    app.UseHsts();

  SetupLogging(null, app);

  app.UseRouting()
     .UseAuthentication()
     .UseAuthorization();

  if (!DisableSwagger && Configuration?.GetValue("DisableSwagger", false) != true)
    app.UseSwagger().UseSwaggerUI(o => SetupSwaggerUI(o, provider));

  app.UseEndpoints(endpoints =>
  {
    endpoints.MapHealthChecks("/healthz");
    endpoints.MapControllers();
  });
}
```

A few things worth calling out here:

* **Swagger is on by default** and can be switched off with the `DisableSwagger` config key
  (or the `DisableSwagger` property), which is handy in production behind a gateway.
* **`/healthz`** is always mapped.
* Authentication and authorization middleware are always in the pipeline.

## The bootstrapper

`Program.cs` uses a static helper instead of the usual `WebApplication.CreateBuilder`:

```csharp
CoreWebStartup.CreateDefaultHostBuilder<Startup>()
  .UseLogging()   // extension method added by a logging package
  .Build()
  .Run();
```

`CreateDefaultHostBuilder<TStartup>()` is simply the standard Generic Host with your
startup plugged in:

```csharp
Host.CreateDefaultBuilder()
    .ConfigureWebHostDefaults(web => web.UseStartup<TStartup>());
```

The `.UseLogging()` call is an extension supplied by whichever logging package you
reference.

## Mental model

Think of NRSRx as a **template method pattern** applied to an ASP.NET startup.

> The base class owns the *algorithm* (the order in which concerns are wired up). You
> supply the *steps* that are specific to your service by overriding virtual methods.

Because nothing is sealed or private, you can override at any granularity, from "just give
me a database" all the way down to "replace how JWT tokens are validated."

## Where to go next

* [Cross-Cutting Concerns](./cross-cutting-concerns.md) is the catalog of what's handled.
* [Configuration](./configuration.md) covers the keys the pipeline reads.
* [Authentication & Authorization](./authentication-authorization.md) covers step 7 in
  depth.
