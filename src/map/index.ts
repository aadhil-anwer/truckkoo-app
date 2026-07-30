/**
 * The map module's public surface.
 *
 * Nothing outside `src/map/` computes a projection or draws a coastline. Screens
 * import from here.
 */
export { MapCanvas, useProjection } from './MapCanvas';
export { BBOX, project, projectionFor, type Framing } from './framing';
export { Corridor } from './Corridor';
export { CityPin, type PinState } from './CityPin';
export { TruckMarker } from './TruckMarker';
export { Scrim } from './Scrim';
export { ROAD_FACTOR, greatCircleKm, roadHours, roadKm, type Coord } from './distance';
