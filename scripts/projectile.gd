# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name Projectile
extends RefCounted

const DungeonSystemScript = preload("res://scripts/dungeon.gd")
const EntitiesDataScript = preload("res://scripts/entities_data.gd")

var owner = null
var dir: int = DungeonSystemScript.DIR_SE
var x: int = 0
var y: int = 0
var lvl: int = 1
var t: float = 0.0
var speed: float = 7.0
var travelled: float = 0.0
var max_range: float = 11.0
var kind: int = 1
var pierce: int = 0
var hit_ids: Dictionary = {}
var alive: bool = true
var spin: float = 0.0

func _init(p_owner = null, p_dir: int = 4):
	owner = p_owner
	dir = p_dir
	if p_owner != null:
		x = p_owner.x
		y = p_owner.y
		lvl = p_owner.lvl
		kind = EntitiesDataScript.missile_kind_for(p_owner.image)
		pierce = p_owner.pierce
	t = 0.0
	speed = 7.0
	travelled = 0.0
	max_range = 11.0
	hit_ids = {}
	alive = true
	spin = randf() * TAU

func render_cell() -> Vector2:
	var v: Vector2i = DungeonSystemScript.DIR_VEC.get(dir, Vector2i.ZERO)
	return Vector2(float(x) + float(v.x) * t, float(y) + float(v.y) * t)

func sprite_rect() -> Rect2:
	var east = dir == DungeonSystemScript.DIR_NE or dir == DungeonSystemScript.DIR_SE
	var front = dir == DungeonSystemScript.DIR_SW or dir == DungeonSystemScript.DIR_SE
	var rx = (384 if east else 0) + (kind - 1) * 64
	var ry = 640 + (64 if front else 0)
	return Rect2(rx, ry, 64, 64)
