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
  protected override IEnumerable<string> GetUserTenants(HttpContext httpContext)
  {
    // Read tenant memberships from a custom JWT claim.
    return httpContext.User.Claims
        .Where(c => c.Type == "tenant_id")
        .Select(c => c.Value);
  }
}
```

The base class then compares the returned tenants against the `TenantId` property on the
model (resolved via `ITentantable`) and rejects requests where the user's tenants don't
include the requested tenant.

Apply your concrete attribute to controllers that should enforce tenant scoping:

```csharp
[Authorize]
[TenantFilter]
public class DocumentsController : ControllerBase
{
  [HttpGet("{id}")]
  public async Task<ActionResult<Document>> Get([FromRoute] Guid id)
  {
    // The filter has already verified that the request's tenantId
    // is one the user belongs to.
    var doc = await _db.Documents.FindAsync(id);
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

// The TenantFilterAttribute will allow this request because the user
// has the "acme-corp" tenant.
var response = await client.GetAsync($"api/v1/Documents/{docId}");
response.EnsureSuccessStatusCode();
```

To test the rejection path, omit the tenant claim or use a different tenant:

```csharp
var token = GenerateTestToken(claims =>
{
  claims.Add(new Claim("tenant_id", "wrong-tenant"));
});
GenerateAuthHeader(client, token);

var response = await client.GetAsync($"api/v1/Documents/{docId}");
Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
```
