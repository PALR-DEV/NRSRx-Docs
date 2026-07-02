---
id: swagger
title: Swagger & OpenAPI
sidebar_label: Swagger & OpenAPI
---

# Swagger & OpenAPI

NRSRx generates **OpenAPI** documents and serves the **Swagger UI** automatically. The
project treats good API docs as non-negotiable:

> When it comes to API documentation, the OpenAPI spec has become the de-facto standard…
> Ensuring that these components are available to developers will be crucial to
> facilitating cross-team integration and success.

## What you get by default

- A Swagger UI served at the site root (or a route prefix you choose).
- One OpenAPI document **per API version** (driven by the versioned API explorer).
- The Swagger UI wired up as an **OIDC client**, so developers can log in and call secured
  endpoints from the docs.
- Filters that improve the generated spec: default values, auth requirements,
  reverse-proxy awareness, and enum schema enrichment.

## How it's wired

Swagger registration happens in `SetupSwagger`:

```csharp
services
  .AddHttpClient()
  .AddTransient<IConfigureOptions<SwaggerGenOptions>>(sp =>
      new ConfigureSwaggerOptions(sp, Configuration, this))
  .AddSwaggerGen(options => SetupSwaggerGen(options));
```

`SetupSwaggerGen` adds the framework's operation/document filters:

```csharp
options.OperationFilter<DefaultValueFilter>();       // honors [DefaultValue]
options.OperationFilter<AuthorizeOperationFilter>();  // marks secured operations
options.DocumentFilter<ReverseProxyDocumentFilter>(); // correct paths behind a gateway
options.SchemaFilter<EnumSchemaFilter>();             // enriches enum schemas with names
```

The OData flavor additionally applies `ODataCommonOperationFilter` and
`ODataCommonDocumentFilter` to handle OData-specific paths and parameters in the spec.

In the HTTP pipeline (`Configure`), Swagger is served unless disabled:

```csharp
if (!DisableSwagger && Configuration?.GetValue("DisableSwagger", false) != true)
  app.UseSwagger().UseSwaggerUI(o => SetupSwaggerUI(o, provider));
```

## EnumSchemaFilter

By default, Swagger/NSwag renders enum properties as bare integers. The
`EnumSchemaFilter` (registered automatically by NRSRx) enriches enum schemas so both
the integer value and the named string appear in the spec. This makes the API more
readable and is required for accurate client code generation.

No configuration is needed — it is always applied.

## Surfacing your XML documentation

Turn on XML doc comments to enrich the spec with your `///` summaries:

1. Enable XML output in your `.csproj`:

   ```xml
   <PropertyGroup>
     <GenerateDocumentationFile>true</GenerateDocumentationFile>
   </PropertyGroup>
   ```

2. Set the flag in your `Startup`:

   ```csharp
   public override bool IncludeXmlCommentsInSwaggerDocs => true;
   ```

3. To include comments from **other** assemblies (e.g. your Models project), list their
   XML files:

   ```csharp
   public override string[] AdditionalAssemblyXmlDocumentFiles => new[]
   {
     typeof(Course).Assembly.Location.Replace(".dll", ".xml",
       StringComparison.InvariantCultureIgnoreCase)
   };
   ```

## OIDC login from Swagger

`SetupSwaggerCommonUi` configures the OAuth flow for the "Authorize" button, including
PKCE:

```csharp
options.OAuthClientId(Configuration.GetValue<string>("SwaggerClientId"));
options.OAuthClientSecret(Configuration.GetValue<string>("SwaggerClientSecret"));
options.OAuthAppName(Configuration.GetValue<string>("SwaggerAppName"));
options.OAuthScopeSeparator(" ");
options.OAuthUsePkce();
```

Set `SwaggerClientId` (and a secret/app name if your provider needs them) in
configuration, and register that client + its redirect URI in your identity provider. Then
developers click **Authorize**, sign in, and call protected endpoints directly.

The scopes requested default to OpenID; override `SwaggerScopes` to request more:

```csharp
public override IEnumerable<OAuthScope> SwaggerScopes =>
  new[] { OAuthScope.OpenId, /* your API scopes */ };
```

## Testing Swagger

`IkeMtz.NRSRx.Core.Unigration` provides `SwaggerUnitTests` helpers that verify your
Swagger UI and JSON document are generated correctly in tests:

```csharp
[TestMethod]
public async Task SwaggerUi_LoadsSuccessfully()
{
  using var srv = new TestServer(
      TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>());
  await SwaggerUnitTests.TestHtmlPageAsync(srv);
}

[TestMethod]
public async Task SwaggerJson_IsValid()
{
  using var srv = new TestServer(
      TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>());
  await SwaggerUnitTests.TestJsonDocAsync(srv);
}

[TestMethod]
public async Task SwaggerJson_BehindReverseProxy()
{
  using var srv = new TestServer(
      TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>());
  await SwaggerUnitTests.TestReverseProxyJsonDocAsync(srv);
}
```

These three tests are recommended for every NRSRx service to catch Swagger misconfiguration
early.

## Customizing the UI

| Property / method | Effect |
| --- | --- |
| `ServiceTitle` | Sets the document title (`"{title} - Swagger UI"`). |
| `SwaggerUiRoutePrefix` | Serves the UI under a path prefix instead of the root. |
| `DisableSwagger` | Turns Swagger off entirely (or use the `DisableSwagger` config key). |
| `SetupSwaggerCommonUi` (override) | Full control over the `SwaggerUIOptions`. |

Out of the box the UI enables deep linking and filtering, and adds a `robots: none` meta
tag so the docs aren't indexed by search engines.
