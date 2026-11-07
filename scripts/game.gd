# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name MurkGame
extends Node2D

const DungeonSystemScript = preload("res://scripts/dungeon.gd")
const EntitiesDataScript = preload("res://scripts/entities_data.gd")
const EntityScript = preload("res://scripts/entity.gd")
const ProjectileScript = preload("res://scripts/projectile.gd")
const AudioManagerScript = preload("res://scripts/audio_manager.gd")
const DungeonViewScript = preload("res://scripts/dungeon_view.gd")

var ds = null
var audio = null
var view = null

# Game state: "SPLASH", "SELECT", "PLAYING", "PAUSED", "PERK", "MAP", "MODAL"
var state: String = "SPLASH"
var class_key: String = "fighter"
var episode_num: int = 1
var lvl: int = 1
var player = null
var entities: Array = []
var projectiles: Array = []
var home: Dictionary = {}
var deaths: int = 0
var team2_lair = null
var rivals_enabled: bool = false
var dungeon_awake: bool = false
var path: Array = []
var attack_target = null

var ep_stats = { "kills": 0, "time": 0.0, "deaths": 0, "items": 0 }

# Nodes
@onready var camera: Camera2D = $Camera2D
@onready var ui_canvas: CanvasLayer = $UICanvas
@onready var splash_panel: Control = $UICanvas/SplashScreen
@onready var select_panel: Control = $UICanvas/SelectScreen
@onready var hud_panel: Control = $UICanvas/HUD
@onready var modal_panel: Control = $UICanvas/ModalScreen
@onready var pause_panel: Control = $UICanvas/PauseScreen
@onready var perk_panel: Control = $UICanvas/PerkScreen
@onready var map_panel: Control = $UICanvas/MapScreen

# HUD labels & bars
@onready var hp_fill: ColorRect = $UICanvas/HUD/BottomPanel/Bars/HpBar/Fill
@onready var hp_text: Label = $UICanvas/HUD/BottomPanel/Bars/HpBar/Text
@onready var ar_fill: ColorRect = $UICanvas/HUD/BottomPanel/Bars/ArBar/Fill
@onready var ar_text: Label = $UICanvas/HUD/BottomPanel/Bars/ArBar/Text
@onready var xp_fill: ColorRect = $UICanvas/HUD/BottomPanel/Bars/XpBar/Fill
@onready var xp_text: Label = $UICanvas/HUD/BottomPanel/Bars/XpBar/Text

@onready var lbl_floor: Label = $UICanvas/HUD/BottomPanel/Stats/FloorVal
@onready var lbl_score: Label = $UICanvas/HUD/BottomPanel/Stats/ScoreVal
@onready var lbl_level: Label = $UICanvas/HUD/BottomPanel/Stats/LevelVal
@onready var lbl_rings: Label = $UICanvas/HUD/BottomPanel/Stats/RingsVal
@onready var lbl_episode: Label = $UICanvas/HUD/TopLeftEpisode
@onready var lbl_toast: Label = $UICanvas/HUD/ToastLabel
@onready var lbl_prompt: Label = $UICanvas/HUD/StairsPrompt

var toast_timer: float = 0.0
var modal_callback: Callable = Callable()

func _ready():
	ds = DungeonSystemScript.new()
	audio = AudioManagerScript.new()
	add_child(audio)
	view = $DungeonView

	load_level_defs()
	show_splash()

func load_level_defs():
	var file = FileAccess.open("res://assets/levels.json", FileAccess.READ)
	if file:
		var json = JSON.new()
		if json.parse(file.get_as_text()) == OK:
			ds.load_level_defs(json.get_data())

func show_splash():
	state = "SPLASH"
	splash_panel.visible = true
	select_panel.visible = false
	hud_panel.visible = false
	modal_panel.visible = false
	pause_panel.visible = false
	perk_panel.visible = false
	map_panel.visible = false

func show_select():
	state = "SELECT"
	splash_panel.visible = false
	select_panel.visible = true
	audio.play("button.wav")

func start_game(selected_class: String):
	class_key = selected_class
	episode_num = 1
	player = null
	deaths = 0
	select_panel.visible = false
	hud_panel.visible = true
	audio.play("Spawn.wav")
	begin_episode()

func begin_episode():
	var def = EntitiesDataScript.CLASS_DEFS.get(class_key, EntitiesDataScript.CLASS_DEFS["fighter"])
	var ep = ds.get_episode(def.get("file", "levelsb.dat"), episode_num)
	ds.build(ep)
	projectiles.clear()
	entities.clear()
	path.clear()
	attack_target = null
	ep_stats = { "kills": 0, "time": 0.0, "deaths": 0, "items": 0 }
	team2_lair = null
	rivals_enabled = (ep.get("gametype", 1) == 2)
	dungeon_awake = false

	var home_spot = ds.random_floor(1)
	home = { "x": home_spot.get("x", 5), "y": home_spot.get("y", 5), "lvl": 1 }
	ds.cell(home.x, home.y, 1)["pad"] = def.get("pad", 0)

	if player == null:
		player = EntityScript.new({
			"kind": "player", "type": "player", "name": def.name, "image": def.image, "team": 1,
			"classKey": class_key, "x": home.x, "y": home.y, "lvl": 1,
			"hp": def.hp + (randi() % 10), "armour": def.armour, "rings": def.rings,
			"dmin": def.dmin, "dmax": def.dmax, "shots": def.shots, "fireCd": def.fireCd,
			"tileTime": def.tileTime, "fireSound": def.fireSound
		})
	else:
		player.teleport(home.x, home.y, 1)
		player.hp = player.max_hp
		player.protection = 0.0
		player.carrying = 0
		player.shots = 0
		player.fire_timer = 0.0

	player.dir = DungeonSystemScript.DIR_SE
	player.alive = true
	entities.append(player)

	spawn_population(ep)
	lvl = 1
	setup_level_view()
	state = "PLAYING"
	toast("Entered Episode " + str(episode_num) + " - Find the blue treasure!")

func spawn_population(ep: Dictionary):
	var spawn_monsters = func(key: String, count: int, speed: int):
		var def = EntitiesDataScript.MONSTER_DEFS.get(key)
		if not def: return
		for i in range(count):
			var spawn_lvl = (randi() % (ds.maxlevel - 1)) + 2
			var p = ds.random_floor(spawn_lvl)
			if p.is_empty(): continue
			var e = EntityScript.new({
				"kind": "monster", "type": key, "name": def.name, "image": def.image, "team": 0,
				"x": p.x, "y": p.y, "lvl": spawn_lvl,
				"hp": def.hp + min(30, episode_num - 1) + (randi() % 3),
				"dmin": def.dmin, "dmax": def.dmax, "shots": def.shots, "fireCd": def.fireCd,
				"aggr": def.aggr,
				"tileTime": EntitiesDataScript.BASE_TILE_TIME * (1.0 + 0.55 * (max(1, speed) - 1)),
				"asleep": true,
				"fireSound": "fireball.wav" if (def.image in [2, 4, 5, 9]) else "throw.wav"
			})
			e.dir = 1 + (randi() % 4)
			entities.append(e)

	spawn_monsters.call("beholder", ep.get("beholders", 0), ep.get("bspeed", 1))
	spawn_monsters.call("mouther", ep.get("mouther", 0), ep.get("mspeed", 1))
	spawn_monsters.call("ogre", ep.get("ogre", 0), ep.get("ospeed", 1))
	spawn_monsters.call("skeleton", ep.get("skeletons", 0), ep.get("sspeed", 1))
	spawn_monsters.call("deathorb", ep.get("deathorb", 0), ep.get("dspeed", 1))

func setup_level_view():
	view.ds_ref = ds
	view.cur_lvl = lvl
	view.player_ref = player
	view.entities_ref = entities
	view.projectiles_ref = projectiles
	ds.reveal(lvl, player.x, player.y)
	update_hud()

func _process(delta: float):
	if state == "PLAYING":
		ep_stats["time"] += delta
		update_game(delta)
	update_camera(delta)
	update_hud()
	if toast_timer > 0.0:
		toast_timer -= delta
		if toast_timer <= 0.0:
			lbl_toast.visible = false

func update_camera(_delta: float):
	if player:
		var p_world = DungeonViewScript.grid_to_world(player.render_cell().x, player.render_cell().y)
		var shake_offset = Vector2.ZERO
		if view.screen_shake > 0.0:
			shake_offset = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * view.screen_shake * 4.0
		camera.position = p_world + shake_offset

func update_game(delta: float):
	# Update entities
	for e in entities:
		var arrived = e.update(delta)
		if arrived and e == player:
			on_player_arrive()

	# AI thinking
	for e in entities:
		if e == player or not e.alive:
			continue
		if e.lvl == lvl:
			update_ai(e, delta)

	# Update projectiles
	update_projectiles(delta)

	# Player attack auto-target
	handle_player_input(delta)

func update_ai(e, delta: float):
	if e.asleep and not dungeon_awake:
		# Monster awakens if player gets close
		if abs(e.x - player.x) + abs(e.y - player.y) <= 5:
			e.asleep = false
			audio.play("dragon.wav", 0.4)
		return

	e.think_timer -= delta
	if e.think_timer <= 0.0:
		e.think_timer = randf_range(0.2, 0.4)
		# Face or shoot at target
		if hostile(e, player):
			var dist = abs(e.x - player.x) + abs(e.y - player.y)
			if (e.x == player.x or e.y == player.y) and dist <= 7:
				var shoot_dir = DungeonSystemScript.dir_from_delta(player.x - e.x, player.y - e.y)
				e.dir = shoot_dir
				try_fire(e, shoot_dir)
			elif not e.is_moving():
				# Move toward player
				var step_path = ds.find_path(lvl, e.x, e.y, player.x, player.y)
				if step_path.size() > 0:
					var next_pos: Vector2i = step_path[0]
					var move_dir = DungeonSystemScript.dir_from_delta(next_pos.x - e.x, next_pos.y - e.y)
					e.start_move(next_pos.x, next_pos.y, move_dir)

func hostile(a, b) -> bool:
	if a == b or not a.alive or not b.alive: return false
	if a.is_monster(): return not b.is_monster()
	if b.is_monster(): return true
	return a.team != b.team

func try_fire(ent, fire_dir: int):
	if ent.shots >= ent.max_shots or ent.fire_timer > 0.0 or not ent.alive:
		return
	ent.fire_timer = ent.fire_cd
	ent.shots += 1
	var proj = ProjectileScript.new(ent, fire_dir)
	projectiles.append(proj)
	if ent.fire_sound != "":
		audio.play(ent.fire_sound, 0.5)

func update_projectiles(delta: float):
	var i = projectiles.size() - 1
	while i >= 0:
		var p = projectiles[i]
		if p.lvl == lvl and p.alive:
			p.t += delta * p.speed
			while p.alive and p.t >= 1.0:
				p.t -= 1.0
				var v: Vector2i = DungeonSystemScript.DIR_VEC.get(p.dir, Vector2i.ZERO)
				var nx = p.x + v.x
				var ny = p.y + v.y
				if not ds.walkable(nx, ny, p.lvl):
					p.alive = false
					break
				p.x = nx
				p.y = ny
				p.travelled += 1.0
				if p.travelled >= p.max_range:
					p.alive = false
					break
				check_projectile_hit(p)
			if p.alive:
				check_projectile_hit(p)
		else:
			p.alive = false

		if not p.alive:
			if p.owner:
				p.owner.shots = max(0, p.owner.shots - 1)
			projectiles.remove_at(i)
		i -= 1

func check_projectile_hit(p):
	for target in entities:
		if target.lvl != p.lvl or not target.alive:
			continue
		if target == p.owner or not hostile(p.owner, target):
			continue
		if target.x == p.x and target.y == p.y:
			# Hit!
			var dmg = p.owner.roll_damage()
			var res = target.take_hit(dmg)
			audio.play("impact.wav", 0.5)
			if target == player:
				view.screen_shake = 4.0
				audio.play("ouch.wav", 0.6)
			if not target.alive:
				target.death_timer = 0.8
				audio.play("dead.wav" if target.is_monster() else "die.wav", 0.6)
				if p.owner == player:
					ep_stats["kills"] += 1
					gain_xp(10)
			p.alive = false
			break

func gain_xp(amount: int):
	player.xp += amount
	if player.xp >= player.next_level_at:
		player.xp -= player.next_level_at
		player.level += 1
		player.next_level_at = int(player.next_level_at * 1.5)
		show_perk_selection()

func on_player_arrive():
	ds.reveal(lvl, player.x, player.y)
	var cell = ds.cell(player.x, player.y, lvl)

	# Check items
	var it = str(cell.get("item", "0"))
	match it:
		"e":
			if player.hp < player.max_hp:
				var heal = min(player.max_hp - player.hp, 10 + player.level * 2)
				player.hp += heal
				cell["item"] = 0
				audio.play("item.wav", 0.5)
				toast("Elixir restores " + str(heal) + " health.")
		"a":
			player.armour += 5
			cell["item"] = 0
			audio.play("item.wav", 0.5)
			toast("You don the armour (+5 armour).")
		"s":
			player.armour += 5
			cell["item"] = 0
			audio.play("item.wav", 0.5)
			toast("The scroll weaves a ward (+5 armour).")
		"r":
			player.rings += 1
			cell["item"] = 0
			audio.play("item.wav", 0.5)
			toast("A Ring of Protection! (press R to use)")

	# Check relics
	for r in ds.relics:
		if r.get("carrier") == null and r.get("lvl") == lvl and r.get("x") == player.x and r.get("y") == player.y:
			r["carrier"] = player
			player.carrying = r.get("id")
			audio.play("treasure.wav", 0.8)
			if not dungeon_awake:
				dungeon_awake = true
				toast("You seized the blue treasure! Escape back to your pad!", "good")
				audio.play("DRAGON.WAV", 0.6)
			break

	# Check win condition at home pad
	if player.carrying == 2 and home.get("lvl") == lvl and player.x == home.x and player.y == home.y:
		deliver_relic()

	lbl_prompt.visible = (str(cell.get("type")) == "s")
	if lbl_prompt.visible:
		lbl_prompt.text = "Press E to climb down" if str(cell.get("stair")) == "down" else "Press E to climb up"

func deliver_relic():
	player.carrying = 0
	audio.play("win.wav", 0.8)
	player.armour += 30
	player.rings += 3
	show_modal(
		"EPISODE COMPLETE",
		"Episode " + str(episode_num) + " Cleared!\nKills: " + str(ep_stats.kills) + "\nTime: " + str(int(ep_stats.time)) + "s\n\nReward: +30 Armour, +3 Rings!",
		func():
			episode_num += 1
			begin_episode()
	)

func handle_player_input(_delta: float):
	if not player or not player.alive:
		return

	if Input.is_action_just_pressed("use_ring"):
		use_ring()

	if Input.is_action_just_pressed("drop_relic"):
		drop_relic()

func use_ring():
	if not player or not player.alive or player.rings <= 0:
		return
	player.rings -= 1
	player.protection = 8.0
	audio.play("Protection.wav", 0.7)
	toast("Ring of Protection activated! (8s invulnerability)")

func drop_relic():
	if not player or not player.alive or player.carrying <= 0:
		return
	var relic = ds.relic(player.carrying)
	if not relic.is_empty():
		relic["carrier"] = null
		relic["x"] = player.x
		relic["y"] = player.y
		relic["lvl"] = player.lvl
	player.carrying = 0
	audio.play("button.wav", 0.5)
	toast("You set down the relic.")

	if Input.is_action_just_pressed("use_stairs"):
		use_stairs()

	if Input.is_action_just_pressed("fire"):
		try_fire(player, player.dir)

	if Input.is_action_just_pressed("toggle_map"):
		toggle_map()

	if Input.is_action_just_pressed("toggle_pause"):
		toggle_pause()

	if not player.is_moving():
		var move_dir = 0
		if Input.is_action_pressed("move_up"): move_dir = DungeonSystemScript.DIR_NE
		elif Input.is_action_pressed("move_down"): move_dir = DungeonSystemScript.DIR_SW
		elif Input.is_action_pressed("move_left"): move_dir = DungeonSystemScript.DIR_NW
		elif Input.is_action_pressed("move_right"): move_dir = DungeonSystemScript.DIR_SE

		if move_dir != 0:
			var v: Vector2i = DungeonSystemScript.DIR_VEC[move_dir]
			var nx = player.x + v.x
			var ny = player.y + v.y
			if ds.walkable(nx, ny, lvl):
				player.start_move(nx, ny, move_dir)
				audio.play("walk.wav", 0.3)
			else:
				player.dir = move_dir

func use_stairs():
	var cell = ds.cell(player.x, player.y, lvl)
	if str(cell.get("type")) != "s":
		toast("There is no ladder here.")
		return
	var stair_kind = str(cell.get("stair"))
	var target_lvl = lvl + 1 if stair_kind == "down" else lvl - 1
	if target_lvl >= 1 and target_lvl <= ds.maxlevel:
		lvl = target_lvl
		player.teleport(player.x, player.y, lvl)
		audio.play("walk.wav", 0.5)
		setup_level_view()
		toast("Climbed to Floor " + str(lvl))

func update_hud():
	if not player: return
	lbl_floor.text = str(lvl)
	lbl_score.text = str(player.skill)
	lbl_level.text = str(player.level)
	lbl_rings.text = str(player.rings)
	lbl_episode.text = "Episode " + str(episode_num)

	var hp_pct = clampf(float(player.hp) / float(max(1, player.max_hp)), 0.0, 1.0)
	hp_fill.size.x = 180.0 * hp_pct
	hp_text.text = str(player.hp) + " / " + str(player.max_hp)

	var ar_pct = clampf(float(player.armour) / 50.0, 0.0, 1.0)
	ar_fill.size.x = 180.0 * ar_pct
	ar_text.text = str(player.armour)

	var xp_pct = clampf(float(player.xp) / float(max(1, player.next_level_at)), 0.0, 1.0)
	xp_fill.size.x = 180.0 * xp_pct
	xp_text.text = str(player.xp) + " / " + str(player.next_level_at)

func toast(msg: String, _type: String = "info"):
	lbl_toast.text = msg
	lbl_toast.visible = true
	toast_timer = 3.0

func show_modal(title: String, body: String, callback: Callable = Callable()):
	modal_callback = callback
	$UICanvas/ModalScreen/Panel/Title.text = title
	$UICanvas/ModalScreen/Panel/Content.text = body
	modal_panel.visible = true
	state = "MODAL"

func on_modal_close():
	modal_panel.visible = false
	state = "PLAYING"
	if modal_callback.is_valid():
		var cb = modal_callback
		modal_callback = Callable()
		cb.call()

func toggle_map():
	if state == "PLAYING":
		state = "MAP"
		map_panel.visible = true
	elif state == "MAP":
		state = "PLAYING"
		map_panel.visible = false

func toggle_pause():
	if state == "PLAYING":
		state = "PAUSED"
		pause_panel.visible = true
	elif state == "PAUSED":
		state = "PLAYING"
		pause_panel.visible = false

func show_perk_selection():
	state = "PERK"
	perk_panel.visible = true
	audio.play("win.wav", 0.5)

func select_perk(perk_name: String):
	match perk_name:
		"damage":
			player.dmax += 1
			toast("Damage increased! (" + str(player.dmin) + "-" + str(player.dmax) + ")")
		"shots":
			player.max_shots += 1
			toast("Missile volley increased to " + str(player.max_shots))
		"speed":
			player.tile_time = max(0.15, player.tile_time * 0.9)
			toast("Movement speed increased!")
	perk_panel.visible = false
	state = "PLAYING"
