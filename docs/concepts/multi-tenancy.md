---
id: multi-tenancy
title: Multi-Tenancy
sidebar_label: Multi-Tenancy
---

# Multi-Tenancy

NRSRx supports multi-tenant data scoping through the `ITentantable` model interface and
the `CoreTenantFilterAttribute` action filter.

:::caution Spelling note
The interface in the source code is spelled `ITentantable` (double `t`) — this is a typo
in the original source that is preserved for backwards compatibility. Always use
`ITentantable` in your code. Typing `ITenantable` will produce a compile error.
:::

## ITentantable

Add `ITentantable` to any entity that is scoped to a tenant:

```csharp
public interface ITentantable
{
  string TenantId { get; set; }
}
```

```csharp
public class Document : IIdentifiable, IAuditable, ITentantable
{
  public Guid Id { get; set; }
  public string TenantId { get; set; }
  public string Title { get; set; }
  public string Content { get; set; }

  // IAuditable fields...
  public string CreatedBy { get; set; }
  public DateTimeOffset CreatedOnUtc { get; set; }
  public string? UpdatedBy { get; set; }
  public DateTimeOffset? UpdatedOnUtc { get; set; }
  public int? UpdateCount { get; set; }
}
```

## CoreTenantFilterAttribute

`CoreTenantFilterAttribute` is an **abstract** base class in `IkeMtz.NRSRx.Core.Web`.
You must subclass it and implement `GetUserTenants(HttpContext)` to define how the current
user's tenant memberships are determined:

```csharp
public class TenantFilterAttribute : CoreTenantFilterAttribute
{
  public override IEnumerable<string> GetUserTenants(HttpContext httpContext)
  {
    // Read tenant memberships from a custom JWT claim.
    return httpContext.User.Claims
        .Where(c => c.Type == "tenant_id")
        .Select(c => c.Value);
  }
}
```

The base class implements `IAuthorizationFilter` and validates the **`tid` query-string
parameter** on every request:

1. If the request has no `tid` query parameter → **400 Bad Request**
   (`"Query string param tid is required for this endpoint."`).
2. If `GetUserTenants` returns no tenants → **401 Unauthorized**
   (`"The current user doesn't have access to any tenants."`).
3. If `tid` is not among the user's tenants → **401 Unauthorized**
   (`"The current user doesn't have access to the {tid} tenant."`).

Note the filter only *authorizes* the requested tenant — it does not automatically filter
your database query. Your action still needs to scope its query to the `tid` value (which
is now guaranteed to be one the caller belongs to).

Apply your concrete attribute to controllers that should enforce tenant scoping:

```csharp
[Authorize]
[TenantFilter]
public class DocumentsController : ControllerBase
{
  // Callers must include ?tid={tenantId} — the filter rejects the
  // request otherwise.
  [HttpGet("{id}")]
  public async Task<ActionResult<Document>> Get(
      [FromRoute] Guid id, [FromQuery] string tid)
  {
    // The filter has verified the caller belongs to `tid`;
    // scope the query to it yourself.
    var doc = await _db.Documents
        .FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tid);
    return doc == null ? NotFound() : Ok(doc);
  }
}
```

## Scoping database queries by tenant

In addition to filtering at the action level, add an EF global query filter so leaked
cross-tenant queries are impossible even without the attribute:

```csharp
// In your DbContext.OnModelCreating:
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
  // Assumes TenantId is injected via ICurrentUserProvider or a scoped service.
  modelBuilder.Entity<Document>()
    .HasQueryFilter(d => d.TenantId == _currentTenantId);
}
```

## Combining with OData

For OData read services, you can combine `CoreTenantFilterAttribute` with
`ExpandPermissionsFilterAttribute` to both scope the tenant and restrict which navigations
are available:

```csharp
[ApiVersion("1.0")]
[Authorize]
[TenantFilter]
public class DocumentsController : ODataController
{
  [EnableQuery]
  [ExpandPermissionsFilter(new[] { "docs:read-sensitive" }, expandClause: "SensitiveData")]
  public IQueryable<Document> Get() =>
    _db.Documents.Where(d => d.TenantId == _currentTenantId).AsNoTracking();
}
```

## Testing tenant-scoped endpoints

In unigration tests, inject a `tenant_id` claim into the test token:

```csharp
var token = GenerateTestToken(claims =>
{
  claims.Add(new Claim("tenant_id", "acme-corp"));
});
GenerateAuthHeader(client, token);

// The TenantFilterAttribute allows this request: ?tid=acme-corp matches
// the user's "acme-corp" tenant claim.
var response = await client.GetAsync($"api/v1/Documents/{docId}?tid=acme-corp");
response.EnsureSuccessStatusCode();
```

To test the rejection paths:

```csharp
// Wrong tenant → 401 Unauthorized.
var token = GenerateTestToken(claims =>
{
  claims.Add(new Claim("tenant_id", "wrong-tenant"));
});
GenerateAuthHeader(client, token);

var response = await client.GetAsync($"api/v1/Documents/{docId}?tid=acme-corp");
Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);

// Missing ?tid= entirely → 400 Bad Request.
response = await client.GetAsync($"api/v1/Documents/{docId}");
Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
```
