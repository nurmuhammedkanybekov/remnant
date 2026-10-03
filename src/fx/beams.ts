import * as THREE from "three";

/**
 * A shaft of light through dusty air, faked: an open cone drawn additively,
 * brightest along its axis and near where the light comes from, fading to
 * nothing at its edges (by how square-on you see the surface) and at its far
 * end. No real volumetrics, so it costs one transparent draw.
 */
export function beamMaterial(color: THREE.ColorRepresentation, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vFacing;
      void main() {
        // The cone's own Y runs from its source (top, 0.5) to its far end (bottom, -0.5).
        vAlong = 0.5 - position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vAlong;
      varying float vFacing;
      void main() {
        float a = pow(vFacing, 2.2) * pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6) * uStrength;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** A cone of light `length` long, opening from `r0` at its source to `r1`, pointing down its local -Y. */
export function beamMesh(r0: number, r1: number, length: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r0, r1, length, 24, 1, true);
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 2;
  return m;
}
