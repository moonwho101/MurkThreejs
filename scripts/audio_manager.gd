# Copyright (c) Mark Longo 2026
# Ported to Godot 4.7.2
class_name MurkAudioManager
extends Node

const SOUND_FILES = [
	"alive.wav", "back.wav", "bsword.wav", "button.wav", "dead.wav", "deathorb.wav", "die.wav",
	"DRAGON.WAV", "Drip2.wav", "ewizard.wav", "fireball.wav", "impact.wav", "item.wav", "mouther.wav",
	"orb.wav", "ouch.wav", "Protection.wav", "Skeleton.wav", "Spawn.wav", "tcleric.wav", "throw.wav",
	"throw2.wav", "treasure.wav", "tsword.wav", "walk.wav", "win.wav"
]

var samples: Dictionary = {}
var muted: bool = false
var sfx_volume: float = 1.0
var amb_volume: float = 1.0

var amb_player: AudioStreamPlayer = null
var drip_timer: float = 3.0

var sfx_players: Array[AudioStreamPlayer] = []
const POOL_SIZE = 16

func _ready():
	load_all_sounds()
	setup_players()

func load_all_sounds() -> void:
	for filename in SOUND_FILES:
		var path = "res://assets/sound/" + filename
		if FileAccess.file_exists(path):
			var res = AudioStreamWAV.load_from_file(path)
			if res:
				samples[filename.to_lower()] = res

func setup_players() -> void:
	amb_player = AudioStreamPlayer.new()
	amb_player.bus = "Master"
	amb_player.volume_db = linear_to_db(0.18 * amb_volume)
	add_child(amb_player)

	for i in range(POOL_SIZE):
		var p = AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		sfx_players.append(p)

	if samples.has("back.wav"):
		amb_player.stream = samples["back.wav"]
		if amb_player.stream is AudioStreamWAV:
			amb_player.stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		if not muted:
			amb_player.play()

func _process(delta: float):
	if muted or amb_volume <= 0.0:
		return
	drip_timer -= delta
	if drip_timer <= 0.0:
		play("drip2.wav", 0.12, 1.0)
		drip_timer = 4.0 + randf() * 9.0

func set_volumes(sfx: float, amb: float) -> void:
	sfx_volume = sfx
	amb_volume = amb
	if amb_player:
		amb_player.volume_db = linear_to_db(max(0.0001, 0.18 * amb_volume))

func toggle_mute() -> bool:
	muted = not muted
	if amb_player:
		if muted:
			amb_player.stop()
		else:
			amb_player.play()
	return muted

func play(name_str: String, volume: float = 0.5, pitch: float = 1.0) -> void:
	if muted or sfx_volume <= 0.0:
		return
	var key = name_str.to_lower()
	if not samples.has(key):
		return
	var stream: AudioStream = samples[key]

	var chosen: AudioStreamPlayer = null
	for p in sfx_players:
		if not p.playing:
			chosen = p
			break
	if chosen == null and not sfx_players.is_empty():
		chosen = sfx_players[0]

	if chosen:
		chosen.stream = stream
		chosen.pitch_scale = pitch
		chosen.volume_db = linear_to_db(max(0.0001, volume * sfx_volume))
		chosen.play()
