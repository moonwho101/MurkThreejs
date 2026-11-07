extends SceneTree

const DungeonView = preload("res://scripts/dungeon_view.gd")

func _init():
	print("--- Running test_view.gd ---")
	var view = DungeonView.new()
	assert(view != null, "DungeonView creation failed")

	# Test isometric coordinate conversion
	var w = DungeonView.grid_to_world(5, 5)
	var g = DungeonView.world_to_grid(w)
	assert(abs(g.x - 5.0) < 0.01 and abs(g.y - 5.0) < 0.01, "Isometric coordinate roundtrip failed")

	# Test shader compilation
	var shader = load("res://scripts/torchlight.gdshader")
	assert(shader != null, "Torchlight shader failed to load")

	print("--- test_view.gd PASSED ---")
	quit(0)
