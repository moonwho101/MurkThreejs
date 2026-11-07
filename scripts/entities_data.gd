# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name EntitiesData
extends RefCounted

const BASE_TILE_TIME = 0.28

const SPRITE_ROW = {
	1: 0,
	2: 128,
	3: 256,
	4: 384,
	5: 512,
	6: 768,
	7: 896,
	8: 1024,
	9: 128
}

const CLASS_DEFS = {
	"fighter": {
		"name": "Warrior", "image": 1, "file": "levelsb.dat", "pad": 0,
		"hp": 40, "dmin": 2, "dmax": 3, "shots": 4, "fireCd": 0.30, "tileTime": 0.29, "rings": 1, "armour": 5,
		"wearsArmour": true, "readsScrolls": false, "fireSound": "throw.wav"
	},
	"cleric": {
		"name": "Cleric", "image": 5, "file": "levelsc.dat", "pad": 3,
		"hp": 36, "dmin": 1, "dmax": 3, "shots": 4, "fireCd": 0.30, "tileTime": 0.28, "rings": 2, "armour": 0,
		"wearsArmour": false, "readsScrolls": true, "fireSound": "fireball.wav"
	},
	"thief": {
		"name": "Thief", "image": 3, "file": "levelst.dat", "pad": 1,
		"hp": 34, "dmin": 1, "dmax": 3, "shots": 4, "fireCd": 0.22, "tileTime": 0.24, "rings": 1, "armour": 3,
		"wearsArmour": true, "readsScrolls": false, "fireSound": "tsword.wav"
	},
	"wizard": {
		"name": "Wizard", "image": 4, "file": "levelsw.dat", "pad": 2,
		"hp": 30, "dmin": 2, "dmax": 4, "shots": 4, "fireCd": 0.34, "tileTime": 0.28, "rings": 1, "armour": 0,
		"wearsArmour": false, "readsScrolls": true, "fireSound": "fireball.wav"
	}
}

const CLASS_BY_IMAGE = {
	1: "fighter",
	5: "cleric",
	3: "thief",
	4: "wizard"
}

const MONSTER_DEFS = {
	"beholder": { "name": "Beholder", "image": 2, "hp": 30, "dmin": 2, "dmax": 4, "shots": 3, "fireCd": 0.55, "aggr": 0.7, "sound": "orb.wav", "wake": "DRAGON.WAV" },
	"mouther": { "name": "Gibbering Mouther", "image": 7, "hp": 6, "dmin": 1, "dmax": 1, "shots": 2, "fireCd": 0.8, "aggr": 0.9, "sound": "mouther.wav", "wake": "mouther.wav" },
	"ogre": { "name": "Brute", "image": 8, "hp": 15, "dmin": 1, "dmax": 3, "shots": 4, "fireCd": 0.7, "aggr": 0.7, "sound": "throw2.wav", "wake": "DRAGON.WAV" },
	"skeleton": { "name": "Skeleton", "image": 6, "hp": 10, "dmin": 1, "dmax": 1, "shots": 2, "fireCd": 0.9, "aggr": 0.8, "sound": "Skeleton.wav", "wake": "Skeleton.wav" },
	"deathorb": { "name": "Death Orb", "image": 9, "hp": 50, "dmin": 2, "dmax": 6, "shots": 8, "fireCd": 0.3, "aggr": 0.7, "sound": "deathorb.wav", "wake": "deathorb.wav" }
}

static func missile_kind_for(image: int) -> int:
	match image:
		1: return 1
		2: return 3
		3: return 1
		4: return 3
		5: return 4
		6: return 1
		7: return 6
		8: return 2 if randf() < 0.5 else 5
		9: return 4
		_: return 1
