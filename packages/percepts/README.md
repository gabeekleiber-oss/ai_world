# @ai-world/percepts

Per-mind identity handles and spatial memory primitives for the AI World simulation.

## Handles

Create a separate `HandleRegistry` for every mind. The registry assigns stable handles on first observation, using a shared sequence so numbering records encounter order across entity kinds:

```ts
const handles = new HandleRegistry();
handles.getOrCreate("world-entity-42", "thing"); // thing-1
handles.getOrCreate("mind-2", "other");          // other-2
handles.getOrCreate("hall", "place");            // place-3
```

The entity key is an internal world identity and should not be exposed to the agent. Repeated calls for the same key return the same handle. Registries and labels must not be shared between minds. Labels are private, may be replaced, and can be removed with `label(handle, null)`; labels longer than 40 characters are rejected.

## Known places

`KnownPlaces` is also per mind. Call `observe` when a place or thing is perceived. Re-observing an entry updates its description, bearing, distance in steps, and numeric simulation `seenAt` time without changing its position in first-observed order. `list()` returns defensive copies with the current private label attached. Rendering code can convert `seenAt` to the relative phrase required by the percept format.

The package contains data primitives only. It does not inspect the world, calculate visibility, render natural-language percepts, or call a model.
