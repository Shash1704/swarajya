/** Whether to draw in 3D (remembered per browser), and whether this browser can. No Babylon here: it stays out of the main bundle. */
const KEY = 'swarajya-3d';

export function want3D(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setWant3D(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // private browsing: the choice just isn't remembered
  }
}

let gl: boolean | null = null;
export function hasWebGL(): boolean {
  if (gl !== null) return gl;
  try {
    const c = document.createElement('canvas');
    gl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    gl = false;
  }
  return gl;
}

export const canvas3d = () => document.getElementById('view3d') as HTMLCanvasElement;
