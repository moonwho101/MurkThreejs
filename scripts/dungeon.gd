# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name DungeonSystem
extends RefCounted

const DIR_NW = 1
const DIR_NE = 2
const DIR_SW = 3
const DIR_SE = 4

const DIRS = [DIR_NW, DIR_NE, DIR_SW, DIR_SE]

const DIR_VEC = {
	DIR_NW: Vector2i(-1, 0),
	DIR_NE: Vector2i(0, -1),
	DIR_SW: Vector2i(0, 1),
	DIR_SE: Vector2i(1, 0)
}

const MIN_DUNGEON_SIZE = 8
const MAX_DUNGEON_SIZE = 200

var N: int = 14
var maxlevel: int = 3
var levels: Dictionary = {}
var pits: Array = []
var relics: Array = []
var tile_type: Dictionary = {}
var level_definitions: Dictionary = {}
var episode_cache: Dictionary = {}
var current_episode_def: Dictionary = {}

static func dir_from_delta(dx: int, dy: int) -> int:
	if abs(dx) >= abs(dy):
		return DIR_NW if dx < 0 else DIR_SE
	return DIR_NE if dy < 0 else DIR_SW

static func dir_from_vector(v: Vector2) -> int:
	if abs(v.x) >= abs(v.y):
		return DIR_NW if v.x < 0 else DIR_SE
	return DIR_NE if v.y < 0 else DIR_SW

func make_void_cell() -> Dictionary:
	return { "type": 0, "item": 0, "explored": 0, "pad": -1, "stair": "" }

func load_level_defs(json_data: Dictionary) -> void:
	level_definitions = json_data
	episode_cache.clear()

func parse_episodes(filename: String) -> Array:
	if episode_cache.has(filename):
		return episode_cache[filename]
	var raw = level_definitions.get(filename, level_definitions.get("levelsb.dat", []))
	if raw is Array:
		episode_cache[filename] = raw
		return raw
	var lines: PackedStringArray = []
	if raw is String:
		lines = (raw as String).split("\n")
	var episodes: Array = []
	var num = func(i: int) -> int:
		if i < lines.size():
			return lines[i].strip_edges().to_int()
		return 0

	var i = 0
	while i + 30 <= lines.size():
		var b = i + 2
		episodes.append({
			"response": lines[i].strip_edges(),
			"title": lines[i + 1].strip_edges(),
			"gametype": num.call(b),
			"beholders": num.call(b + 1), "bspeed": num.call(b + 2),
			"deathorb": num.call(b + 3), "dspeed": num.call(b + 4),
			"skeletons": num.call(b + 5), "sspeed": num.call(b + 6),
			"mouther": num.call(b + 7), "mspeed": num.call(b + 8),
			"ogre": num.call(b + 9), "ospeed": num.call(b + 10),
			"fighter": num.call(b + 11), "fteam": num.call(b + 12), "fspeed": num.call(b + 13),
			"cleric": num.call(b + 14), "cteam": num.call(b + 15), "cspeed": num.call(b + 16),
			"thief": num.call(b + 17), "tteam": num.call(b + 18), "tspeed": num.call(b + 19),
			"wizard": num.call(b + 20), "wteam": num.call(b + 21), "wspeed": num.call(b + 22),
			"dungeonx": num.call(b + 23), "dungeony": num.call(b + 24), "dungeonlvl": num.call(b + 25),
			"pits": num.call(b + 26), "maxpit": num.call(b + 27)
		})
		i += 30

	if episodes.is_empty():
		episodes.append({
			"response": "Find the -p and return it to -k .", "title": "Episode 1", "gametype": 1,
			"beholders": 1, "bspeed": 2, "deathorb": 0, "dspeed": 1, "skeletons": 4, "sspeed": 2,
			"mouther": 2, "mspeed": 2, "ogre": 1, "ospeed": 2,
			"fighter": 0, "fteam": 0, "fspeed": 1, "cleric": 0, "cteam": 0, "cspeed": 1,
			"thief": 0, "tteam": 0, "tspeed": 1, "wizard": 0, "wteam": 0, "wspeed": 1,
			"dungeonx": 14, "dungeony": 14, "dungeonlvl": 3, "pits": 1, "maxpit": 6
		})
	episode_cache[filename] = episodes
	return episodes

func get_episode(filename: String, episode_num: int) -> Dictionary:
	var eps = parse_episodes(filename)
	var idx = (max(1, episode_num) - 1) % eps.size()
	return eps[idx]

func random_num(max_val: int) -> int:
	if max_val <= 0:
		return 0
	return randi() % max_val

func in_bounds(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x <= N + 1 and y <= N + 1

func cell(x: int, y: int, lvl: int) -> Dictionary:
	if not in_bounds(x, y):
		return make_void_cell()
	if not levels.has(lvl):
		return make_void_cell()
	var level_grid: Array = levels[lvl]
	var idx = y * (N + 2) + x
	if idx >= 0 and idx < level_grid.size():
		return level_grid[idx]
	return make_void_cell()

func walkable(x: int, y: int, lvl: int) -> bool:
	var c = cell(x, y, lvl)
	var t = str(c.get("type", 0))
	return t == "f" or t == "s"

func for_each_cell(lvl: int, callable: Callable) -> void:
	for y in range(1, N + 1):
		for x in range(1, N + 1):
			callable.call(cell(x, y, lvl), x, y)

func build(ep: Dictionary) -> Dictionary:
	current_episode_def = ep
	var size = max(ep.get("dungeonx", 14), ep.get("dungeony", 14))
	N = clampi(size, MIN_DUNGEON_SIZE, MAX_DUNGEON_SIZE)
	maxlevel = max(2, ep.get("dungeonlvl", 3))
	pits.clear()
	relics.clear()
	tile_type.clear()
	for l in range(1, maxlevel + 1):
		tile_type[l] = ((l - 1) % 3) + 1

	levels.clear()
	for l in range(1, maxlevel + 1):
		levels[l] = carve_level(l)
		if l > 1:
			link_levels(l - 1, l)

	assign_relics(ep.get("gametype", 1))
	assign_items(8 + maxlevel * 2)
	return ep

func new_level_grid() -> Array:
	var size = (N + 2) * (N + 2)
	var grid: Array = []
	grid.resize(size)
	for i in range(size):
		grid[i] = { "type": 0, "item": 0, "explored": 0, "pad": -1, "stair": "" }
	return grid

func carve_level(lvl: int) -> Array:
	var W = N + 2
	var center = int(N / 2)
	var jumps = 4
	var steps = int(round(1.3 * 75.0 * (N * N) / 196.0))
	var grid: Array = []

	for attempt in range(30):
		grid = new_level_grid()
		var k = int(N * 0.35)
		for y in range(1, N + 1):
			for x in range(1, N + 1):
				if (x + y <= k) or (x + y >= 2 * N - k) or (x - y >= N - k) or (y - x >= N - k):
					grid[y * W + x]["type"] = "u"

		for j in range(jumps):
			var x = center
			var y = center
			grid[y * W + x]["type"] = "f"
			for i in range(steps):
				var d = 1 + random_num(4)
				var v: Vector2i = DIR_VEC[d]
				var nx = x + v.x
				var ny = y + v.y
				if nx <= 0 or nx >= N or ny <= 0 or ny >= N:
					continue
				var t = str(grid[ny * W + nx]["type"])
				if t == "u" or t == "s":
					continue
				if random_num(30) != 1 and completes_block(grid, nx, ny):
					continue
				grid[ny * W + nx]["type"] = "f"
				x = nx
				y = ny

		var floors = 0
		for i in range(grid.size()):
			if str(grid[i]["type"]) == "f":
				floors += 1
		if floors >= max(40, int(N * N * 0.25)):
			break
	return grid

func completes_block(grid: Array, x: int, y: int) -> bool:
	var W = N + 2
	var f = func(ax: int, ay: int) -> bool:
		return str(grid[ay * W + ax]["type"]) == "f"
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			if f.call(x + sx, y) and f.call(x, y + sy) and f.call(x + sx, y + sy):
				return true
	return false

func link_levels(upper: int, lower: int) -> void:
	var candidates: Array = []
	for_each_cell(upper, func(c: Dictionary, x: int, y: int):
		if str(c.get("type")) == "f" and str(cell(x, y, lower).get("type")) == "f":
			candidates.append(Vector2i(x, y))
	)
	for i in range(candidates.size() - 1, 0, -1):
		var j = random_num(i + 1)
		var tmp = candidates[i]
		candidates[i] = candidates[j]
		candidates[j] = tmp

	var placed: Array = []
	for c in candidates:
		if placed.size() >= 3:
			break
		var too_close = false
		for p in placed:
			if abs(p.x - c.x) + abs(p.y - c.y) < 4:
				too_close = true
				break
		if too_close:
			continue
		placed.append(c)

	if placed.is_empty() and not candidates.is_empty():
		placed.append(candidates[0])

	for p in placed:
		var a = cell(p.x, p.y, upper)
		var b = cell(p.x, p.y, lower)
		a["type"] = "s"
		a["stair"] = "down"
		a["item"] = 0
		b["type"] = "s"
		b["stair"] = "up"
		b["item"] = 0

func is_free_floor(x: int, y: int, lvl: int) -> bool:
	var c = cell(x, y, lvl)
	var it = c.get("item", 0)
	var item_empty = (it is int and it == 0) or (str(it) == "0" or str(it) == "")
	return str(c.get("type")) == "f" and item_empty and c.get("pad", -1) < 0

func random_floor(lvl: int, accept: Callable = Callable()) -> Dictionary:
	for tries in range(1000):
		var x = random_num(N) + 1
		var y = random_num(N) + 1
		if is_free_floor(x, y, lvl):
			if accept.is_valid():
				if accept.call(x, y):
					return { "x": x, "y": y, "lvl": lvl }
			else:
				return { "x": x, "y": y, "lvl": lvl }
	return {}

func assign_relics(gametype: int) -> void:
	var deep_lvl = (random_num(maxlevel - 1) + 2) if maxlevel > 1 else 1
	var p2 = random_floor(deep_lvl)
	if p2.is_empty():
		p2 = random_floor(maxlevel)
	if not p2.is_empty():
		relics.append({ "id": 2, "x": p2.x, "y": p2.y, "lvl": p2.lvl, "carrier": null })

func relic(id: int) -> Dictionary:
	for r in relics:
		if r.get("id") == id:
			return r
	return {}

func assign_items(count: int) -> void:
	var pick = func() -> String:
		var r = random_num(5)
		if r == 0:
			return "a"
		if r == 2:
			return "s"
		return "e"
	for i in range(count):
		var p = random_floor(random_num(maxlevel) + 1)
		if not p.is_empty():
			cell(p.x, p.y, p.lvl)["item"] = pick.call()
	for i in range(2):
		var p = random_floor(random_num(maxlevel) + 1)
		if not p.is_empty():
			cell(p.x, p.y, p.lvl)["item"] = "r"

func reveal(lvl: int, x: int, y: int, depth: int = 4) -> bool:
	var changed = false
	var W = N + 2
	var seen: Dictionary = {}
	seen[y * W + x] = true
	var frontier: Array = [Vector2i(x, y)]
	var start = cell(x, y, lvl)
	if str(start.get("type")) != "0" and start.get("explored", 0) == 0:
		start["explored"] = 1
		changed = true

	for d in range(depth):
		if frontier.is_empty():
			break
		var next_frontier: Array = []
		for cur in frontier:
			for dir in DIRS:
				var v: Vector2i = DIR_VEC[dir]
				var nx = cur.x + v.x
				var ny = cur.y + v.y
				var key = ny * W + nx
				if seen.has(key) or not walkable(nx, ny, lvl):
					continue
				seen[key] = true
				var c = cell(nx, ny, lvl)
				if c.get("explored", 0) == 0:
					c["explored"] = 1
					changed = true
				next_frontier.append(Vector2i(nx, ny))
		frontier = next_frontier
	return changed

func find_path(lvl: int, sx: int, sy: int, tx: int, ty: int, blocked: Callable = Callable(), max_nodes: int = -1) -> Array:
	if not walkable(tx, ty, lvl):
		return []
	var W = N + 2
	if max_nodes < 0:
		max_nodes = max(900, N * N)
	var prev: Dictionary = {}
	var start = sy * W + sx
	prev[start] = -1
	var queue: Array = [Vector2i(sx, sy)]
	var head = 0
	while head < queue.size() and head < max_nodes:
		var cur: Vector2i = queue[head]
		head += 1
		if cur.x == tx and cur.y == ty:
			var path: Array = []
			var k = cur.y * W + cur.x
			while k != start:
				path.append(Vector2i(k % W, int(k / W)))
				k = prev[k]
			path.reverse()
			return path
		for dir in DIRS:
			var v: Vector2i = DIR_VEC[dir]
			var nx = cur.x + v.x
			var ny = cur.y + v.y
			var key = ny * W + nx
			if prev.has(key) or not walkable(nx, ny, lvl):
				continue
			if blocked.is_valid() and not (nx == tx and ny == ty) and blocked.call(nx, ny):
				continue
			prev[key] = cur.y * W + cur.x
			queue.append(Vector2i(nx, ny))
	return []

func cast_line(lvl: int, x: int, y: int, dir: int, max_dist: int) -> Array:
	var cells: Array = []
	var cx = x
	var cy = y
	var v: Vector2i = DIR_VEC[dir]
	for i in range(max_dist):
		cx += v.x
		cy += v.y
		if not walkable(cx, cy, lvl):
			break
		cells.append(Vector2i(cx, cy))
	return cells

func find_stairs(lvl: int, kind: String) -> Array:
	var out: Array = []
	for_each_cell(lvl, func(c: Dictionary, x: int, y: int):
		if str(c.get("type")) == "s" and str(c.get("stair")) == kind:
			out.append(Vector2i(x, y))
	)
	return out
