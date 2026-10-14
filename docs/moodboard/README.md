# AI World — visual direction mood board (approval draft)

**Status: awaiting owner approval.** This is a textual reference board, not a collection of imported third-party images or licensed assets. No external asset is bundled.

## North star

**Painterly realism:** a quiet, handcrafted valley rendered with semi-realistic PBR surfaces, softly stylized shapes, warm natural light, and strong atmospheric depth. The scene should feel lived-in without looking cartoonish, hyperreal, or cinematic-horror. Four inhabitants must remain legible at medium camera distance.

## Reference frames / visual beats

| Frame | Composition | Palette and materials | Lighting / atmosphere | What to validate |
| --- | --- | --- | --- | --- |
| A — Dawn valley | Wide elevated view, curved hills framing the pond, hall and cave as distinct silhouettes | Moss greens, muted ochre, cool slate, restrained water blue | Low amber sun, thin valley mist, soft shadow edges | Landmarks read from far camera; terrain does not look tiled |
| B — Communal hall | Human-height view toward wide doorway and raised speaking slab | Weathered timber, rough stone, dry straw; uneven handmade forms | Warm skylight through roof opening, gentle bounce | Interior remains readable; no implied advanced technology |
| C — Cave chamber | Camera just inside cave facing writable wall | Cool mineral stone, subdued luminous moss, earthy pigments | Soft indirect light and restrained moss emission; no torches | Marks stay readable; cave is not frightening or neon |
| D — Inhabitants | Four distinct figures near berry bushes, medium distance | Natural skin/hair variation, simple wraps, subtle silhouette differences | Neutral overcast for color checking | Identity visible without role-coded clothing or props |
| E — Evening pond | Ground-level shore with hall distant in frame | Desaturated blue water, violet-grey rocks, deep olive plants | Last warm rim light, dusk fog, subtle water ripples | Mood persists when sun is low; no oversaturated bloom |
| F — Night navigation | Wide shot of landmarks under stars | Deep navy, muted cool stone, very low chroma | Moonlit silhouettes, restrained ambient fill | Traversable ground and agents remain visible |

## Style guardrails

- **Geometry:** softly simplified silhouettes with convincing scale; irregular, not toy-like. No sharp low-poly faceting as the primary aesthetic.
- **Surfaces:** PBR roughness and restrained specular highlights; hand-authored breakup in dirt, wood, stone, and foliage. Avoid photogrammetry clutter.
- **Palette:** predominantly earthy midtones; use red berries and cave markings as purposeful accents.
- **Lighting:** time-of-day is the primary mood driver. Preserve detail in shadow; avoid blown highlights and extreme color grading.
- **Atmosphere:** subtle height fog, occasional drifting particles and dawn mist. Do not let postprocessing obscure agents or marks.
- **Characters:** shared underlying skeleton with restrained variation in proportions, skin/hair tint and small distinguishing details; no outfits implying professions or technology.
- **World fidelity:** pond contains no life; cave has no fire or torches. Preserve the simulation's physical constraints.
- **Performance:** plan Low/Medium/High/Ultra quality tiers; target 60 fps at 1080p on mid-range discrete GPU, 30 fps on integrated graphics (DESIGN.md §16).

## Approval checklist

Owner should approve or request changes to: (1) overall painterly-realism style, (2) earthy palette and lighting, (3) landmark silhouettes, (4) inhabitants' level of stylization, (5) cave mood and legibility, and (6) performance/fidelity trade-offs.

**Decision:** Pending owner approval. Do not begin heavy modeling until the owner explicitly approves this direction. Once approved, mark VW-14 `done` according to `COORDINATION.md`.

## Asset sourcing

Use `ASSETS.md` to document licenses and provenance before importing external meshes, textures, HDRIs, animations, fonts, or audio. No candidate asset is automatically approved.
