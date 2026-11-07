# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name DungeonView
extends Node2D

const DungeonSystemScript = preload("res://scripts/dungeon.gd")
const EntitiesDataScript = preload("res://scripts/entities_data.gd")
const EntityScript = preload("res://scripts/entity.gd")
const ProjectileScript = preload("res://scripts/projectile.gd")

const TILE_W = 112
const TILE_H = 97

# Isometric projection formulas
# originX: 49 * x - 48 * y
# originY: 25 * x + 24 * y
const FOOT_X = 51
const FOOT_Y = 68
const SPRITE_DX = -31
const SPRITE_DY = -58

const TILE_RECTS = {
	1: Rect2(0, 98, 112, 97),
	2: Rect2(113, 98, 112, 97),
	3: Rect2(226, 98, 112, 97),
	4: Rect2(339, 98, 112, 97),
	12: Rect2(452, 98, 112, 97),
	23: Rect2(565, 98, 112, 97),
	34: Rect2(678, 98, 112, 97),
	14: Rect2(0, 196, 112, 97),
	13: Rect2(113, 196, 112, 97),
	24: Rect2(226, 196, 112, 97),
	123: Rect2(339, 196, 112, 97),
	234: Rect2(452, 196, 112, 97),
	134: Rect2(565, 196, 112, 97),
	124: Rect2(678, 196, 112, 97),
	1234: Rect2(0, 0, 112, 97)
}

const ITEM_ART = {
	"e": { "rect": Rect2(226, 490, 112, 97), "dy": 20 },
	"s": { "rect": Rect2(565, 0, 113, 97), "dy": 0 },
	"r": { "rect": Rect2(678, 0, 113, 97), "dy": 0 },
	"a": { "rect": Rect2(450, 0, 113, 97), "dy": 0 }
}

const PAD_ART = [
	Rect2(113, 294, 112, 97), # 0: player
	Rect2(337, 294, 112, 97), # 1: thief
	Rect2(449, 294, 112, 97), # 2: wizard
	Rect2(561, 294, 112, 97), # 3: cleric
	Rect2(224, 294, 113, 97), # 4: monster lair
	Rect2(337, 294, 112, 97)  # 5: team 2 lair
]

var tex_dungeon: Texture2D
var tex_dungeon2: Texture2D
var tex_dungeon3: Texture2D
var tex_p256: Texture2D

var torch_material: ShaderMaterial
var time_passed: float = 0.0
var light_pos: Vector2 = Vector2.ZERO
var light_radius: float = 300.0
var screen_shake: float = 0.0
var zoom_level: float = 1.0

# References to current game state
var ds_ref = null
var cur_lvl: int = 1
var player_ref = null
var entities_ref: Array = []
var projectiles_ref: Array = []
var hover_cell: Dictionary = {}
var path_crumbs: Array = []
var attack_target = null

static func origin_x(x: float, y: float) -> float:
	return 49.0 * x - 48.0 * y

static func origin_y(x: float, y: float) -> float:
	return 25.0 * x + 24.0 * y

static func grid_to_world(x: float, y: float) -> Vector2:
	return Vector2(origin_x(x, y) + FOOT_X, origin_y(x, y) + FOOT_Y)

static func world_to_grid(w: Vector2) -> Vector2:
	var u = w.x - FOOT_X
	var v = w.y - FOOT_Y
	return Vector2((24.0 * u + 48.0 * v) / 2376.0, (-25.0 * u + 49.0 * v) / 2376.0)

func _ready():
	load_textures()
	var shader = load("res://scripts/torchlight.gdshader")
	if shader:
		torch_material = ShaderMaterial.new()
		torch_material.shader = shader

func load_tex(path: String) -> Texture2D:
	if ResourceLoader.exists(path):
		var r = load(path)
		if r is Texture2D:
			return r
	if FileAccess.file_exists(path):
		var img = Image.load_from_file(path)
		if img:
			return ImageTexture.create_from_image(img)
	return null

func load_textures() -> void:
	tex_dungeon = load_tex("res://assets/dungeon.png")
	tex_dungeon2 = load_tex("res://assets/dungeon2.png")
	tex_dungeon3 = load_tex("res://assets/dungeon3.png")
	tex_p256 = load_tex("res://assets/p256.png")

func get_floor_tex(lvl: int) -> Texture2D:
	if ds_ref == null:
		return tex_dungeon
	var t = ds_ref.tile_type.get(lvl, 1)
	match t:
		2: return tex_dungeon2
		3: return tex_dungeon3
		_: return tex_dungeon

func _process(delta: float):
	time_passed += delta
	if screen_shake > 0.0:
		screen_shake = max(0.0, screen_shake - delta * 2.5)

	if player_ref:
		var p_cell = player_ref.render_cell()
		var p_world = grid_to_world(p_cell.x, p_cell.y)
		light_pos = p_world

	if torch_material:
		torch_material.set_shader_parameter("u_light", light_pos)
		torch_material.set_shader_parameter("u_radius", light_radius)
		torch_material.set_shader_parameter("u_time", time_passed)

	queue_redraw()

func _draw():
	if ds_ref == null:
		return

	# Draw floor tiles, stairs, pads, items
	var floor_tex = get_floor_tex(cur_lvl)
	var N = ds_ref.N

	# Draw list collector for depth-sorted sprites
	var draw_list: Array = []

	for y in range(1, N + 1):
		for x in range(1, N + 1):
			var c = ds_ref.cell(x, y, cur_lvl)
			if c.get("explored", 0) == 0:
				continue
			var t = str(c.get("type", 0))
			if t != "f" and t != "s":
				continue

			var ox = origin_x(x, y)
			var oy = origin_y(x, y)
			var f = func(dx: int, dy: int) -> int:
				return 1 if ds_ref.walkable(x + dx, y + dy, cur_lvl) else 0
			var code = ""
			if f.call(-1, 0): code += "1"
			if f.call(0, -1): code += "2"
			if f.call(1, 0): code += "3"
			if f.call(0, 1): code += "4"
			var key = code.to_int()
			if key == 0: key = 1234
			var tile_rect = TILE_RECTS.get(key, TILE_RECTS[1234])

			var depth_key = (y * (N + 3) + x) * 10
			draw_list.append({
				"depth": depth_key,
				"type": "tile",
				"tex": floor_tex,
				"src": tile_rect,
				"pos": Vector2(ox, oy)
			})

			# Stair
			if t == "s":
				var stair_kind = str(c.get("stair", ""))
				var stair_rect = Rect2(224, 0, 112, 97) if stair_kind == "up" else Rect2(112, 0, 112, 97)
				draw_list.append({
					"depth": depth_key + 1,
					"type": "tile",
					"tex": tex_dungeon,
					"src": stair_rect,
					"pos": Vector2(ox, oy)
				})

			# Pad
			var pad_id = c.get("pad", -1)
			if pad_id >= 0 and pad_id < PAD_ART.size():
				draw_list.append({
					"depth": depth_key + 2,
					"type": "tile",
					"tex": tex_dungeon,
					"src": PAD_ART[pad_id],
					"pos": Vector2(ox, oy + 20)
				})

			# Item
			var it = str(c.get("item", "0"))
			if it != "0" and it != "" and ITEM_ART.has(it):
				var it_info = ITEM_ART[it]
				draw_list.append({
					"depth": depth_key + 3,
					"type": "tile",
					"tex": tex_dungeon,
					"src": it_info["rect"],
					"pos": Vector2(ox, oy + it_info["dy"])
				})

	# Relics on floor
	for relic in ds_ref.relics:
		if relic.get("lvl") == cur_lvl and relic.get("carrier") == null:
			var rx = relic.get("x", 0)
			var ry = relic.get("y", 0)
			var c = ds_ref.cell(rx, ry, cur_lvl)
			if c.get("explored", 0) == 1:
				var ox = origin_x(rx, ry)
				var oy = origin_y(rx, ry)
				var r_rect = Rect2(0, 294, 112, 97) if relic.get("id") == 1 else Rect2(678, 294, 112, 97)
				draw_list.append({
					"depth": (ry * (N + 3) + rx) * 10 + 3,
					"type": "tile",
					"tex": tex_dungeon,
					"src": r_rect,
					"pos": Vector2(ox, oy + 10)
				})

	# Entities
	for e in entities_ref:
		if e.lvl != cur_lvl:
			continue
		if not e.alive and e.death_timer <= 0:
			continue
		var e_cell = e.render_cell()
		var ew = grid_to_world(e_cell.x, e_cell.y)
		var ex = round(ew.x + SPRITE_DX)
		var ey = round(ew.y + SPRITE_DY)
		var d_x = e.x if e.move_t >= 0.5 else e.from_x
		var d_y = e.y if e.move_t >= 0.5 else e.from_y
		var depth_key = (d_y * (N + 3) + d_x) * 10 + 5

		draw_list.append({
			"depth": depth_key,
			"type": "entity",
			"entity": e,
			"pos": Vector2(ex, ey)
		})

	# Projectiles
	for p in projectiles_ref:
		if p.lvl != cur_lvl or not p.alive:
			continue
		var p_cell = p.render_cell()
		var pw = grid_to_world(p_cell.x, p_cell.y)
		var px = round(pw.x + SPRITE_DX)
		var py = round(pw.y + SPRITE_DY)
		var depth_key = (int(p_cell.y) * (N + 3) + int(p_cell.x)) * 10 + 6
		draw_list.append({
			"depth": depth_key,
			"type": "proj",
			"proj": p,
			"pos": Vector2(px, py)
		})

	# Sort by depth
	draw_list.sort_custom(func(a, b): return a["depth"] < b["depth"])

	# Render depth-sorted elements
	for item in draw_list:
		match item["type"]:
			"tile":
				if item["tex"]:
					draw_texture_rect_region(item["tex"], Rect2(item["pos"], item["src"].size), item["src"])
			"entity":
				var e = item["entity"]
				var rect = e.sprite_rect()
				var modulate_color = Color.WHITE
				if e.hit_flash > 0:
					modulate_color = Color(1.0, 0.3, 0.3, 1.0)
				elif e.windup > 0 and e.alive:
					modulate_color = Color(1.5, 1.2, 0.4, 1.0)
				if not e.alive:
					modulate_color.a = clampf(e.death_timer / 0.8, 0.0, 1.0)
				draw_texture_rect_region(tex_p256, Rect2(item["pos"], Vector2(64, 64)), rect, modulate_color)

				# Draw health bar for enemies
				if e.kind != "player" and e.alive and e.hp < e.max_hp:
					var bar_pos = Vector2(item["pos"].x + 8, item["pos"].y - 6)
					draw_rect(Rect2(bar_pos, Vector2(48, 5)), Color(0, 0, 0, 0.7))
					var hp_pct = clampf(float(e.hp) / float(max(1, e.max_hp)), 0.0, 1.0)
					draw_rect(Rect2(bar_pos + Vector2(1, 1), Vector2(46 * hp_pct, 3)), Color(0.85, 0.2, 0.16))

				# Shield ring if protected
				if e.protection > 0.0:
					var foot = grid_to_world(e.render_cell().x, e.render_cell().y)
					draw_arc(foot, 20.0, 0, TAU, 16, Color(0.4, 0.8, 1.0, 0.8), 2.0)
			"proj":
				var p = item["proj"]
				var prect = p.sprite_rect()
				draw_texture_rect_region(tex_p256, Rect2(item["pos"], Vector2(64, 64)), prect)

	# Draw overlays: path breadcrumbs
	for pt in path_crumbs:
		var pw = grid_to_world(pt.x, pt.y)
		draw_circle(pw, 4.0, Color(1.0, 0.9, 0.5, 0.6))

	# Draw hover cell diamond
	if not hover_cell.is_empty():
		var hw = grid_to_world(hover_cell.x, hover_cell.y)
		var pts = PackedVector2Array([
			hw + Vector2(0, -18),
			hw + Vector2(36, 0),
			hw + Vector2(0, 18),
			hw + Vector2(-36, 0)
		])
		var col = Color(1.0, 0.9, 0.5, 0.6) if hover_cell.get("ok", false) else Color(1.0, 0.3, 0.3, 0.5)
		draw_colored_polygon(pts, Color(col.r, col.g, col.b, 0.2))
		draw_polyline(pts + PackedVector2Array([pts[0]]), col, 2.0)

	# Draw target ellipse under attack target
	if attack_target and attack_target.alive and attack_target.lvl == cur_lvl:
		var tw = grid_to_world(attack_target.render_cell().x, attack_target.render_cell().y)
		draw_arc(tw, 24.0, 0, TAU, 24, Color(1.0, 0.3, 0.2, 0.9), 3.0)
