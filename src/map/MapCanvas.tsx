/**
 * The map's base.
 *
 * Sea, neighbouring land, Oman, and the strokes that separate them — then
 * whatever the screen puts on top, in projected space.
 *
 * RTL NOTE. This file uses SVG `x`/`cx`/`d`, which the RTL layout engine does not
 * touch — and must not. A projected x is a position on the Arabian peninsula, not
 * a reading direction: the Gulf does not move to the other side of the screen in
 * Arabic. Only the chrome *around* the map obeys direction.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { geoPath, type GeoProjection } from 'd3-geo';

import geometry from './geometry.json';
import { projectionFor, type Framing } from './framing';
import { map } from '@/theme/tokens';

const ProjectionContext = createContext<GeoProjection | null>(null);

/**
 * The projection the enclosing `MapCanvas` is using.
 *
 * Children take it from context rather than as a prop so a screen physically
 * cannot hand a pin one projection and the canvas another — the failure that puts
 * a city in the sea next to its own coastline.
 */
export function useProjection(): GeoProjection {
  const p = useContext(ProjectionContext);
  if (!p) throw new Error('useProjection must be used inside a MapCanvas');
  return p;
}

export function MapCanvas({
  framing,
  width,
  height,
  children,
}: {
  framing: Framing;
  width: number;
  height: number;
  children?: ReactNode;
}) {
  const projection = useMemo(
    () => projectionFor(framing, width, height),
    [framing, width, height],
  );

  const { omanPath, neighbourPaths } = useMemo(() => {
    const toPath = geoPath(projection);
    return {
      omanPath: toPath(geometry.oman as never) ?? '',
      neighbourPaths: (geometry.neighbours.features as unknown[])
        .map((f) => toPath(f as never))
        .filter((d): d is string => !!d),
    };
  }, [projection]);

  return (
    <ProjectionContext.Provider value={projection}>
      <Svg width={width} height={height}>
        {/* The sea is an explicit fill, not the absence of one — the map is
            often composited over a screen with a different background. */}
        <Rect x={0} y={0} width={width} height={height} fill={map.sea} />

        {/* Neighbours first, so Oman's coastline draws over their border where
            the two meet. */}
        <G testID="map-neighbours">
          {neighbourPaths.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill={map.neighbourLand}
              stroke={map.neighbourBorder}
              strokeWidth={0.9}
            />
          ))}
        </G>

        <Path
          testID="map-oman"
          d={omanPath}
          fill={map.omanLand}
          stroke={map.omanCoast}
          strokeWidth={1}
        />

        {children}
      </Svg>
    </ProjectionContext.Provider>
  );
}
