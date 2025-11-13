/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "@mapbox/mapbox-gl-draw" {
  import type { Map, IControl } from "mapbox-gl";

  // Minimal options type – extend as you need
  export interface MapboxDrawOptions {
    displayControlsDefault?: boolean;
    controls?: any;
    [key: string]: any;
  }

  // Declare MapboxDraw as a control that implements IControl
  export default class MapboxDraw implements IControl {
    constructor(options?: MapboxDrawOptions);

    onAdd(map: Map): HTMLElement;
    onRemove(map: Map): void;

    // Whatever else you actually use:
    getAll(): any;
    trash?: () => void;
  }
}