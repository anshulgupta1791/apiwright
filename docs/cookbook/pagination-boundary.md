# Pagination boundary testing

Paginated list endpoints expose a class of bugs that are invisible to
functional tests: accepting a page size of zero (returns nothing, no
error), accepting a size above the documented maximum (server-side
over-fetch, potential DoS), or accepting a negative page number
(undefined behaviour). APIWright auto-generates a `pagination_boundary`
case for any GET endpoint that declares a `pagination` block.

---

## What you'll have when you're done

A GET endpoint declaration that produces between 2 and 4
`pagination_boundary` regression cases depending on pagination style.
You'll see all three style configurations, what each probe sends and
expects, the two plan-time warnings and how to resolve them, and how to
skip individual probes or all probes at once.

---

## What you need first

- A GET endpoint that accepts a page-size query parameter.
- APIWright installed and at least one environment YAML in place. See
  [quickstart](./quickstart.md) if this is your first endpoint.

---

## How it works

The generator reads the `pagination` block and emits boundary probes.
Each probe sends the declared URL with one query parameter varied to an
edge value and asserts either a 400 rejection or the declared
`expected_status`.

Marker = `regression`.

---

## Step 1 — choose your style and declare the endpoint

### Style `page` — numeric page + size parameters

`tests/users/list.endpoint.json`:

```json
{
  "id": "users.list",
  "name": "GET /users",
  "method": "GET",
  "url": "${env.api_base}/users",
  "pagination": {
    "style": "page",
    "size_param": "size",
    "page_param": "page",
    "default_size": 20,
    "max_size": 100
  },
  "response": {
    "expected_status": 200
  }
}
```

Produces 4 probes:

| Probe | Request | Assertion |
|---|---|---|
| `size_zero` | `GET /users?size=0` | expects 400 |
| `size_max` | `GET /users?size=100` | expects 200 |
| `size_max_plus_one` | `GET /users?size=101` | expects 400 |
| `page_negative` | `GET /users?page=-1` | expects 400 |

### Style `offset` — numeric offset + size parameters

```json
{
  "id": "items.list",
  "method": "GET",
  "url": "${env.api_base}/items",
  "pagination": {
    "style": "offset",
    "size_param": "limit",
    "default_size": 25,
    "max_size": 200
  },
  "response": {
    "expected_status": 200
  }
}
```

Produces 3 probes (`page_negative` is not applicable for offset style):

| Probe | Request | Assertion |
|---|---|---|
| `size_zero` | `GET /items?limit=0` | expects 400 |
| `size_max` | `GET /items?limit=200` | expects 200 |
| `size_max_plus_one` | `GET /items?limit=201` | expects 400 |

### Style `cursor` — opaque token, size-only boundary

```json
{
  "id": "events.list",
  "method": "GET",
  "url": "${env.api_base}/events",
  "pagination": {
    "style": "cursor",
    "size_param": "page_size",
    "default_size": 10,
    "max_size": 50
  },
  "response": {
    "expected_status": 200
  }
}
```

Produces 2 probes (cursor tokens are opaque, so numeric overflow and
negative-page probes do not apply):

| Probe | Request | Assertion |
|---|---|---|
| `size_zero` | `GET /events?page_size=0` | expects 400 |
| `size_max` | `GET /events?page_size=50` | expects 200 |

---

## Step 2 — run the regression suite

```bash
apiwright run --env qa --markers regression
```

When the server enforces the boundaries correctly you will see:

```
INFO: users.list attempt 1: pass    (pagination_boundary:size_zero)
INFO: users.list attempt 1: pass    (pagination_boundary:size_max)
INFO: users.list attempt 1: pass    (pagination_boundary:size_max_plus_one)
INFO: users.list attempt 1: pass    (pagination_boundary:page_negative)
```

---

## Step 3 — understand the plan-time warnings

### Warning 1 — missing `page_param` with `page` style

```
Endpoint 'users.list': pagination_boundary — style 'page' declared without page_param; page_negative probe omitted.
```

You declared `"style": "page"` but did not include `page_param`. The
`page_negative` probe requires a page-number parameter name. The other
three probes still generate.

Fix: add `"page_param": "<your-param-name>"` to the `pagination` block.
If your API truly uses `page` style but does not expose a page-number
parameter, use `offset` style instead.

### Warning 2 — `max_size` less than `default_size`

```
Endpoint 'users.list': pagination_boundary — max_size (5) is less than default_size (20); all probes omitted.
```

The `pagination` block is internally inconsistent: the maximum allowed
size is smaller than the default size. No probes can be generated safely
because the boundary values would be contradictory.

Fix: correct the `max_size` value. It must be ≥ `default_size`. A common
cause is a copy-paste from a different endpoint where the values are
reversed.

---

## Step 4 — skip individual probes

If one probe does not apply to a specific endpoint, skip it by name
without suppressing the others:

```json
{
  "id": "users.list",
  "method": "GET",
  "url": "${env.api_base}/users",
  "pagination": {
    "style": "page",
    "size_param": "size",
    "page_param": "page",
    "default_size": 20,
    "max_size": 100
  },
  "skip_cases": ["pagination_boundary:size_zero"]
}
```

Valid probe names: `size_zero`, `size_max`, `size_max_plus_one`,
`page_negative`.

Use bare `"pagination_boundary"` to skip all probes for that endpoint:

```json
"skip_cases": ["pagination_boundary"]
```

To suppress across every endpoint in the run:

```json
{
  "case_generation": {
    "skip_globally": ["pagination_boundary"]
  }
}
```

See [docs/skip-cases.md](../skip-cases.md) for the full opt-out reference.

---

## Known limitations

**Three styles only.** Only `page`, `offset`, and `cursor` are
supported. Other patterns (link-header pagination, GraphQL-style
connections, custom token schemes) are not recognised. Declare those
endpoints without a `pagination` block and add hand-rolled `assertions`
entries for the boundary conditions you care about.

**Cursor does not probe numeric overflow.** The `size_max_plus_one` and
`page_negative` probes are not generated for `cursor` style because
cursor tokens are opaque — the generator cannot construct a meaningful
out-of-bounds cursor value.

See [docs/limitations.md](../limitations.md) for the full scope boundary.

---

## Where to go next

- **[Test catalog](../test-catalog.md)** — the `pagination_boundary` entry
  with the complete probe table and warning reference.
- **[Skip cases](../skip-cases.md)** — full opt-out reference, including
  the `"kind:probe"` token form.
- **[Limitations](../limitations.md)** — unsupported styles and cursor
  caveats.
- **[Boundary battery](../test-catalog.md#boundary_battery)** — related
  generator for field-level `minimum`/`maximum`/`minLength`/`maxLength`/`enum`
  constraints.
