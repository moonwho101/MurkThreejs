extends SceneTree

const DungeonSystem = preload("res://scripts/dungeon.gd")

func _init():
	print("--- Running test_dungeon.gd ---")
	var ds = DungeonSystem.new()
	assert(ds != null, "DungeonSystem instance creation failed")

	var file = FileAccess.open("res://assets/levels.json", FileAccess.READ)
	assert(file != null, "Could not open levels.json")
	var json_str = file.get_as_text()
	var json = JSON.new()
	var err = json.parse(json_str)
	assert(err == OK, "Failed to parse levels.json")
	var data = json.get_data()
	assert(data is Dictionary, "levels.json data is not Dictionary")

	ds.load_level_defs(data)
	var ep = ds.get_episode("levelsb.dat", 1)
	assert(ep.get("title") == "Episode 1", "Episode 1 title mismatch")

	ds.build(ep)
	assert(ds.levels.size() >= 2, "Levels not generated")
	assert(ds.relics.size() > 0, "Relic not assigned")

	var start_pos = ds.random_floor(1)
	var end_pos = ds.random_floor(1)
	if not start_pos.is_empty() and not end_pos.is_empty():
		var path = ds.find_path(1, start_pos.x, start_pos.y, end_pos.x, end_pos.y)
		print("Path found between floor 1 rooms: ", path.size() > 0)

	var revealed = ds.reveal(1, start_pos.x, start_pos.y)
	assert(revealed or ds.cell(start_pos.x, start_pos.y, 1).get("explored") == 1, "Fog reveal failed")

	print("--- test_dungeon.gd PASSED ---")
	quit(0)
