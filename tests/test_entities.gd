extends SceneTree

const DungeonSystem = preload("res://scripts/dungeon.gd")
const EntitiesData = preload("res://scripts/entities_data.gd")
const Entity = preload("res://scripts/entity.gd")
const Projectile = preload("res://scripts/projectile.gd")

func _init():
	print("--- Running test_entities.gd ---")

	var hero_def = EntitiesData.CLASS_DEFS["fighter"]
	var hero = Entity.new({
		"kind": "player", "type": "player", "name": hero_def.name,
		"image": hero_def.image, "team": 1, "x": 5, "y": 5, "lvl": 1,
		"hp": hero_def.hp, "armour": hero_def.armour, "rings": hero_def.rings,
		"dmin": hero_def.dmin, "dmax": hero_def.dmax, "shots": hero_def.shots,
		"fireCd": hero_def.fireCd, "tileTime": hero_def.tileTime
	})
	assert(hero.hp == 40, "Hero hp incorrect")
	assert(hero.armour == 5, "Hero armour incorrect")
	assert(hero.kind == "player", "Hero kind incorrect")

	var hit1 = hero.take_hit(3)
	assert(hit1.armour == 3, "Armour did not absorb damage")
	assert(hit1.hp == 0, "HP was damaged before armour depleted")
	assert(hero.armour == 2, "Remaining armour incorrect")

	var hit2 = hero.take_hit(5)
	assert(hit2.armour == 2, "Armour depletion incorrect")
	assert(hit2.hp == 3, "HP damage calculation incorrect")
	assert(hero.hp == 37, "Remaining HP incorrect")

	hero.start_move(6, 5, DungeonSystem.DIR_SE)
	assert(hero.is_moving(), "Hero should be moving")
	var arrived = hero.update(hero.tile_time)
	assert(arrived, "Hero should have arrived at destination")
	assert(not hero.is_moving(), "Hero should no longer be moving")
	assert(hero.x == 6 and hero.y == 5, "Hero coordinates not updated")

	var proj = Projectile.new(hero, DungeonSystem.DIR_SE)
	assert(proj.alive, "Projectile not alive")
	assert(proj.kind == 1, "Warrior projectile kind incorrect")
	var r = proj.render_cell()
	assert(r.x == 6.0 and r.y == 5.0, "Projectile initial render cell incorrect")

	print("--- test_entities.gd PASSED ---")
	quit(0)
