# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name Entity
extends RefCounted

const DungeonSystemScript = preload("res://scripts/dungeon.gd")
const EntitiesDataScript = preload("res://scripts/entities_data.gd")

static var _id_counter: int = 1

var id: int = 0
var kind: String = "monster" # player | ally | rival | monster
var type: String = "monster"
var name: String = "Creature"
var image: int = 1
var team: int = 0

var x: int = 0
var y: int = 0
var lvl: int = 1
var from_x: int = 0
var from_y: int = 0
var dir: int = DungeonSystemScript.DIR_SE
var move_t: float = 1.0
var tile_time: float = EntitiesDataScript.BASE_TILE_TIME

var max_hp: int = 10
var hp: int = 10
var armour: int = 0
var rings: int = 0
var protection: float = 0.0
var skill: int = 0
var dmin: int = 1
var dmax: int = 2
var max_shots: int = 2
var fire_cd: float = 0.5
var fire_timer: float = 0.0
var shots: int = 0
var fire_sound: String = ""
var aggr: float = 0.8

var asleep: bool = false
var alive: bool = true
var death_timer: float = 0.0
var respawn_timer: float = 0.0
var hit_flash: float = 0.0
var rest_timer: float = 0.0
var think_timer: float = 0.0
var shot_flash: float = 0.0
var spawn_pos: Vector2i = Vector2i.ZERO
var lair_pos: Vector2i = Vector2i.ZERO
var lair_lvl: int = 1
var class_key: String = ""
var carrying: int = 0
var bob: float = 0.0
var windup: float = 0.0
var windup_dir: int = 0
var overflow: float = 0.0
var pierce: int = 0
var lifesteal: float = 0.0
var perks: Dictionary = {}
var noticed: bool = false
var stair_cd: float = 0.0
var stair_timer: float = 0.0
var stair_goal = null
var stair_wander = null
var is_leader: bool = false

# Player level & progression
var level: int = 1
var xp: int = 0
var next_level_at: int = 25

func _init(cfg: Dictionary = {}):
	id = _id_counter
	_id_counter += 1
	kind = cfg.get("kind", "monster")
	type = cfg.get("type", "monster")
	name = cfg.get("name", "Creature")
	image = cfg.get("image", 1)
	team = cfg.get("team", 0)

	x = cfg.get("x", 0)
	y = cfg.get("y", 0)
	lvl = cfg.get("lvl", 1)
	from_x = x
	from_y = y
	dir = cfg.get("dir", DungeonSystemScript.DIR_SE)
	move_t = 1.0
	tile_time = cfg.get("tileTime", EntitiesDataScript.BASE_TILE_TIME)

	max_hp = cfg.get("hp", 10)
	hp = max_hp
	armour = cfg.get("armour", 0)
	rings = cfg.get("rings", 0)
	protection = 0.0
	skill = 0
	dmin = cfg.get("dmin", 1)
	dmax = cfg.get("dmax", 2)
	max_shots = cfg.get("shots", 2)
	fire_cd = cfg.get("fireCd", 0.5)
	fire_timer = 0.0
	shots = 0
	fire_sound = cfg.get("fireSound", "")
	aggr = cfg.get("aggr", 0.8)

	asleep = cfg.get("asleep", false)
	alive = true
	death_timer = 0.0
	respawn_timer = 0.0
	hit_flash = 0.0
	rest_timer = 0.0
	think_timer = randf() * 0.3
	shot_flash = 0.0

	spawn_pos = Vector2i(x, y)
	var lair_cfg = cfg.get("lair", {})
	if lair_cfg is Dictionary and not lair_cfg.is_empty():
		lair_pos = Vector2i(lair_cfg.get("x", x), lair_cfg.get("y", y))
		lair_lvl = lair_cfg.get("lvl", lvl)
	else:
		lair_pos = Vector2i(x, y)
		lair_lvl = lvl

	class_key = cfg.get("classKey", "")
	carrying = 0
	bob = randf() * TAU
	windup = 0.0
	windup_dir = 0
	overflow = 0.0
	pierce = 0
	lifesteal = 0.0
	perks = {}
	noticed = false
	stair_cd = 0.0
	stair_timer = 0.0
	stair_goal = null
	stair_wander = null
	is_leader = cfg.get("isLeader", false)

func is_monster() -> bool:
	return kind == "monster"

func is_moving() -> bool:
	return move_t < 1.0

func render_cell() -> Vector2:
	var t = move_t
	return Vector2(
		float(from_x) + float(x - from_x) * t,
		float(from_y) + float(y - from_y) * t
	)

func start_move(nx: int, ny: int, new_dir: int) -> void:
	from_x = x
	from_y = y
	x = nx
	y = ny
	dir = new_dir
	move_t = 0.0

func teleport(nx: int, ny: int, nlvl: int) -> void:
	x = nx
	y = ny
	from_x = nx
	from_y = ny
	lvl = nlvl
	move_t = 1.0

func update(dt: float) -> bool:
	var arrived = false
	overflow = 0.0
	if move_t < 1.0:
		var t = move_t + dt / tile_time
		move_t = min(1.0, t)
		if t >= 1.0:
			overflow = (t - 1.0) * tile_time
			from_x = x
			from_y = y
			arrived = true

	if fire_timer > 0.0:
		fire_timer -= dt
	if hit_flash > 0.0:
		hit_flash -= dt
	if shot_flash > 0.0:
		shot_flash -= dt
	if rest_timer > 0.0:
		rest_timer -= dt
	if protection > 0.0:
		protection = max(0.0, protection - dt)
	return arrived

func advance(dt: float) -> void:
	if move_t < 1.0:
		move_t = min(1.0, move_t + dt / tile_time)

func sprite_rect() -> Rect2:
	var col = 0
	if image == 9:
		col = 1
	elif image != 2 and move_t < 1.0:
		col = 1 + min(4, int(move_t * 5.0))

	var east = dir == DungeonSystemScript.DIR_NE or dir == DungeonSystemScript.DIR_SE
	var front = dir == DungeonSystemScript.DIR_SW or dir == DungeonSystemScript.DIR_SE
	var rx = (384 if east else 0) + col * 64
	var row_y = EntitiesDataScript.SPRITE_ROW.get(image, 0)
	var ry = row_y + (64 if front else 0)
	return Rect2(rx, ry, 64, 64)

func roll_damage() -> int:
	if dmax <= dmin:
		return dmin
	return dmin + (randi() % (dmax - dmin + 1))

func take_hit(amount: int) -> Dictionary:
	if protection > 0.0:
		return { "hp": 0, "armour": 0, "blocked": true }
	var left = amount
	var armour_lost = 0
	if armour > 0:
		armour_lost = min(armour, left)
		armour -= armour_lost
		left -= armour_lost
	hp -= left
	hit_flash = 0.18
	return { "hp": left, "armour": armour_lost, "blocked": false }
