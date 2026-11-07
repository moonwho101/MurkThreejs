shader_type canvas_item;

uniform vec2 u_light = vec2(0.0, 0.0);
uniform float u_radius = 300.0;
uniform float u_time = 0.0;
uniform float u_ambient = 0.34;
uniform float u_flash = 0.0;
uniform vec3 u_tint = vec3(1.0, 1.0, 1.0);
uniform float u_alpha = 1.0;

varying vec2 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 0.0, 1.0)).xy;
}

void fragment() {
	vec4 c = texture(TEXTURE, UV);
	if (c.a < 0.08) {
		discard;
	}
	vec2 d = world_pos - u_light;
	d.y *= 2.0;
	float r = u_radius * (1.0 + 0.035 * sin(u_time * 7.0) + 0.02 * sin(u_time * 13.0 + 1.3));
	float f = clamp(1.0 - length(d) / r, 0.0, 1.0);
	f = f * f * (3.0 - 2.0 * f);
	vec3 cool = vec3(0.62, 0.68, 1.0) * u_ambient;
	vec3 warm = vec3(1.12, 0.96, 0.78);
	vec3 lit = mix(cool, warm, f);
	vec3 rgb = c.rgb * lit * u_tint + u_flash * vec3(0.9, 0.12, 0.1);
	COLOR = vec4(rgb, c.a * u_alpha * COLOR.a);
}
