/**
 * The map module's public surface.
 *
 * Nothing outside `src/map/` computes a projection or draws a coastline. Screens
 * import from here.
 */
export { MapCanvas, useProjection } from './MapCanvas';
export { BBOX, project, projectionFor, type Framing } from './framing';
