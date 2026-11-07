extends SceneTree

const MurkAudioManager = preload("res://scripts/audio_manager.gd")

func _init():
	print("--- Running test_audio.gd ---")
	var audio = MurkAudioManager.new()
	audio.load_all_sounds()

	assert(audio != null, "Audio manager creation failed")
	assert(audio.samples.size() > 0, "No audio samples loaded! Size was 0")
	print("Loaded sound samples: ", audio.samples.size())

	var is_muted = audio.toggle_mute()
	assert(is_muted == true, "Mute toggle failed")
	audio.toggle_mute()
	assert(audio.muted == false, "Unmute toggle failed")

	print("--- test_audio.gd PASSED ---")
	quit(0)
