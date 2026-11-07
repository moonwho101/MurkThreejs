extends SceneTree

func _init():
	print("--- Running test_game.gd Integration Tests ---")
	var main_scene = load("res://scenes/main.tscn")
	assert(main_scene != null, "Failed to load main.tscn")
	var game = main_scene.instantiate()
	assert(game != null, "Failed to instantiate main.tscn")
	get_root().add_child(game)
	run_tests(game)

func run_tests(game):
	await process_frame

	# 1. Test Splash to Select transition
	print("1. Testing Splash -> Select screen...")
	assert(game.state == "SPLASH", "Initial state not SPLASH")
	game.show_select()
	assert(game.state == "SELECT", "State did not change to SELECT")
	assert(game.select_panel.visible, "Select panel not visible")

	# 2. Test Character Selection & Game Start
	print("2. Testing start_game with Warrior...")
	game.start_game("fighter")
	assert(game.state == "PLAYING", "State did not change to PLAYING")
	assert(game.player != null, "Player not initialized")
	assert(game.player.kind == "player", "Player kind mismatch")
	assert(game.player.alive, "Player should be alive")
	assert(game.hud_panel.visible, "HUD panel not visible")
	assert(game.entities.size() > 1, "Monsters were not spawned")

	# 3. Test Movement & Stair usage
	print("3. Testing movement and stair usage...")
	var initial_floor = game.lvl
	var stairs_down = game.ds.find_stairs(initial_floor, "down")
	if not stairs_down.is_empty():
		var s_pos: Vector2i = stairs_down[0]
		game.player.teleport(s_pos.x, s_pos.y, initial_floor)
		game.use_stairs()
		assert(game.lvl == initial_floor + 1, "Player failed to climb down stairs")
		print("Successfully descended from floor ", initial_floor, " to ", game.lvl)

	# 4. Test Combat and Projectiles
	print("4. Testing combat and firing...")
	var initial_shots = game.player.shots
	game.try_fire(game.player, 4)
	assert(game.projectiles.size() > 0, "Projectile was not spawned")
	assert(game.player.shots == initial_shots + 1, "Player shot count not incremented")

	# 5. Test Relic Pickup & Progression
	print("5. Testing relic pickup...")
	var relic = game.ds.relic(2)
	assert(not relic.is_empty(), "Relic 2 does not exist")
	relic.x = game.player.x
	relic.y = game.player.y
	relic.lvl = game.lvl
	relic.carrier = null
	game.on_player_arrive()
	assert(game.player.carrying == 2, "Player did not pick up relic 2")
	assert(game.dungeon_awake, "Dungeon did not awaken upon relic pickup")

	# 6. Test Ring of Protection
	print("6. Testing Ring of Protection...")
	game.player.rings = 2
	Input.action_press("use_ring")
	game.handle_player_input(0.016)
	Input.action_release("use_ring")
	assert(game.player.rings == 1, "Ring count was not decremented")
	assert(game.player.protection > 0.0, "Player protection shield was not activated")

	# 7. Test Perk Selection
	print("7. Testing Perk Selection...")
	var prev_dmax = game.player.dmax
	game.select_perk("damage")
	assert(game.player.dmax == prev_dmax + 1, "Damage perk was not applied correctly")

	print("--- All Integration Tests Passed Successfully! ---")
	quit(0)
