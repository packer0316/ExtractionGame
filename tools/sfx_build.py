"""Builds the game's sound effects (public/sfx) from CC0 source recordings.

    python tools/sfx_build.py <source-dir>

<source-dir> must hold:
  kflat/<name>.ogg   every .ogg from these Kenney packs, flattened into one folder
                     (casino-audio, digital-audio, impact-sounds, interface-sounds,
                     music-jingles, rpg-audio, sci-fi-sounds, ui-audio — kenney.nl, CC0)
  fs/<id>.mp3        Freesound sounds by id (HQ previews), all CC0 — see CREDITS below

Each entry below says where a sound comes from, how it is cut and how it is
mixed. One-shots are loudness-matched and written as mono MP3; loops are made
seamless with an equal-power crossfade and written as WAV (MP3 pads the start
and end with silence, which would leave a gap every time a loop repeats).
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100
LOOP_SR = 22050

# layer: (source, start, end, gain[, delay])   source = "fs:<id>" or "k:<name>"
SOUNDS = {
    # ---- hammer on the glass eye
    'whoosh':        [('fs:422513', 0, 0.31, 1.0)],
    'hammer_hit':    [('k:impactMetal_heavy_000', 0, None, 1.0), ('k:impactGlass_heavy_000', 0, None, 0.8), ('k:impactPunch_heavy_000', 0, None, 0.5)],
    'glass_crack':   [('fs:686849', 0, 0.6, 1.0), ('k:impactGlass_medium_000', 0, None, 0.7)],
    'glass_break':   [('fs:221528', 0.32, 1.3, 1.0)],
    'glass_shatter': [('fs:336425', 0, 3.69, 1.0), ('fs:758207', 0, 0.9, 0.55)],
    'glass_slowmo':  [('fs:349905', 0.08, 5.11, 1.0)],
    'shard_1': [('k:impactGlass_light_000', 0, None, 1.0)],
    'shard_2': [('k:impactGlass_light_001', 0, None, 1.0)],
    'shard_3': [('k:impactGlass_light_002', 0, None, 1.0)],
    'shard_4': [('k:impactGlass_light_003', 0, None, 1.0)],
    'spark_1': [('fs:189630', 0, None, 1.0)],
    'spark_2': [('k:glitch_002', 0, None, 1.0)],
    'spark_3': [('k:glitch_003', 0, None, 1.0)],
    'power_down': [('k:zapThreeToneDown', 0.09, None, 1.0)],
    # ---- pulling a tooth
    'forceps_clamp': [('k:metalLatch', 0, None, 1.0)],
    'creak_1': [('k:creak1', 0.05, None, 1.0)],
    'creak_2': [('k:creak2', 0, None, 1.0)],
    'creak_3': [('k:creak3', 0, None, 1.0)],
    'bone_crack':       [('fs:147993', 0.2, 0.7, 1.0)],
    'bone_crack_small': [('fs:872378', 0.05, 0.33, 1.0)],
    'grind':            [('fs:630594', 0, 0.45, 1.0)],
    'tooth_pop':  [('fs:641074', 0, 0.59, 1.0), ('fs:872378', 0.05, 0.33, 0.8)],
    'nerve_snap': [('fs:257927', 0, None, 1.0)],
    'tooth_drop_1': [('k:impactPlate_light_000', 0, None, 1.0)],
    'tooth_drop_2': [('k:impactPlate_light_001', 0, None, 1.0)],
    'tooth_drop_3': [('k:impactPlate_light_002', 0, None, 1.0)],
    'slip':      [('fs:697758', 0.7, 1.7, 1.0)],
    'heartbeat': [('fs:688735', 0, 0.62, 1.0)],
    # ---- the machine moving
    'servo_move':  [('fs:875419', 0, 1.07, 1.0)],
    'servo_spin_1': [('fs:723999', 10.12, 10.98, 1.0)],
    'servo_spin_2': [('fs:723999', 11.58, 12.37, 1.0)],
    'servo_spin_3': [('fs:723999', 12.85, 13.33, 1.0)],
    'servo_whine': [('fs:740246', 0.1, 1.25, 1.0)],
    'hydraulic':   [('fs:581083', 0, 1.4, 1.0)],
    'air_release': [('fs:131302', 0.22, 0.85, 1.0)],
    'jaw_clunk':   [('k:impactMetal_light_000', 0, None, 1.0), ('k:impactPlate_heavy_000', 0, None, 0.5)],
    'gear_burst':  [('fs:813061', 0, 1.75, 1.0)],
    'rebuild':     [('fs:813066', 0, 4.5, 1.0)],
    'ratchet':     [('fs:333611', 0, 1.08, 1.0)],
    # ---- prizes
    'ping':    [('k:glass_001', 0, None, 1.0)],
    'chips_1': [('k:chips-stack-1', 0.07, None, 1.0)],
    'chips_2': [('k:chips-stack-2', 0, None, 1.0)],
    'chips_3': [('k:chips-stack-3', 0, None, 1.0)],
    'coins_1': [('k:handleCoins', 0.04, None, 1.0)],
    'coins_2': [('k:handleCoins2', 0, None, 1.0)],
    'coins_shower': [('fs:334969', 0.2, 5.6, 1.0)],
    'slot_bells':   [('fs:204481', 1.88, 4.8, 1.0)],
    'jingle_small': [('k:jingles_PIZZI07', 0, None, 1.0)],
    'jingle_win':   [('k:jingles_STEEL07', 0, None, 1.0)],
    'fanfare_big':  [('fs:607407', 0, 4.2, 1.0)],
    'fanfare_mega': [('fs:456966', 0, 4.44, 1.0)],
    'fanfare_angel': [('fs:812468', 0, 6.27, 1.0)],
    'boom':       [('k:lowFrequency_explosion_000', 0, None, 1.0)],
    'bell_heavy': [('k:impactBell_heavy_000', 0, None, 1.0)],
    'lose':       [('k:lowThreeTone', 0.09, None, 1.0)],
    # ---- interface
    'ui_click': [('k:click_001', 0, None, 1.0)],
    'ui_hover': [('k:select_001', 0, None, 1.0)],
    'bet_1':    [('k:chip-lay-1', 0.04, None, 1.0)],
    'bet_2':    [('k:chip-lay-2', 0, None, 1.0)],
    'deny':     [('k:error_006', 0, None, 1.0)],
}

# fades in seconds (fade-out shapes the cut end of trimmed recordings)
FADES = {
    'whoosh': (0, 0.05), 'glass_crack': (0, 0.2), 'glass_break': (0, 0.35), 'glass_shatter': (0, 0.6),
    'glass_slowmo': (0.03, 1.6), 'slip': (0, 0.45), 'heartbeat': (0, 0.06), 'hydraulic': (0, 0.55),
    'air_release': (0, 0.2), 'rebuild': (0, 0.6), 'coins_shower': (0.02, 1.2), 'slot_bells': (0, 0.5),
    'fanfare_big': (0, 1.0), 'fanfare_mega': (0, 0.8), 'fanfare_angel': (0, 1.3),
    'servo_spin_1': (0.02, 0.08), 'servo_spin_2': (0.02, 0.08), 'servo_spin_3': (0.02, 0.08),
    'grind': (0, 0.08), 'bone_crack': (0, 0.05), 'tooth_pop': (0, 0.08),
}

# loop: (source, start, end, crossfade)
LOOPS = {
    'idle_drone': ('fs:854269', 1.0, 6.5, 0.6),   # industrial machine hum
    'idle_tick':  ('fs:212181', 0.70, 3.68, 0.05), # three gear ticks one second apart, cut in the gaps
    'servo_loop': ('fs:723999', 2.0, 5.0, 0.4),   # steady servo motor for head and jaw motion
    'payout_loop': ('fs:361346', 0.3, 3.6, 0.35), # slot machine paying out: the score count-up
}

CREDITS = {
    '854269': 'Industrial Machine Drone (Seamless Loop) — kkenny101', '212181': 'Loopable Ticking Clock — OwlStorm',
    '723999': 'Servo motor working — D31V228', '361346': 'slot machine payout — jack126guy',
    '422513': 'Swinging staff whoosh (strong) 04 — Nightflame', '686849': 'glass shatter — ccen18',
    '221528': 'Glass Break — unfa', '336425': 'Glass Shattering and Falling — 221Beimesche',
    '758207': 'Glass panel shattering — LukaCafuka', '349905': 'Slow Motion Glass Shatter — bevibeldesign',
    '189630': 'Spark — elliott.klein', '147993': 'Bone Cracking — bewareofkites20', '872378': 'Bone Crack — cb9382',
    '630594': 'bone break_5 — Vinni_R', '641074': 'Bone Snap/Break — Ryanz-Official', '257927': 'Bones Crack 2 — Kane53126',
    '697758': 'Metal Resonant Scrape Impact — SoundDesignForYou', '688735': 'Heartbeat 97 BPM — Cloud-10',
    '875419': 'Robotic Servo Short Arm Movement — harrisonlace', '740246': 'Servo 8 — JoontheFloof',
    '581083': 'Pressure Hiss — magnuswaker', '131302': 'release_air_pffft — reg7783',
    '813061': 'Robot mechanism-002 — AudioPapkin', '813066': 'Robot mechanism-007 — AudioPapkin', '333611': 'Ratchet2 — blevesque4',
    '334969': 'Many Coins Dumped on a Wooden Surface — dominictreis', '204481': 'BIG SLOT PAYOUT_0331 — gthall',
    '607407': 'Fanfare 3 - Rpg — colorsCrimsonTears', '456966': 'Success Fanfare Trumpets — FunWithSound',
    '812468': 'Angelic Fanfare 2 — qubodup',
}


def decode(src_dir, ref, sr):
    kind, name = ref.split(':', 1)
    path = os.path.join(src_dir, 'fs', f'{name}.mp3') if kind == 'fs' else os.path.join(src_dir, 'kflat', f'{name}.ogg')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def cut(x, sr, start, end):
    a = int(round(start * sr))
    b = len(x) if end is None else min(len(x), int(round(end * sr)))
    return x[a:b]


def fade(x, sr, fin, fout):
    if fin > 0:
        n = min(len(x), int(fin * sr)); x[:n] *= np.linspace(0, 1, n) ** 2
    if fout > 0:
        n = min(len(x), int(fout * sr)); x[-n:] *= np.linspace(1, 0, n) ** 2
    # always a tiny ramp so a cut never clicks
    n = min(len(x), 64); x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n)
    return x


def loudest_rms(x, sr, win=0.05):
    n = max(1, int(win * sr))
    if len(x) <= n:
        return float(np.sqrt(np.mean(x ** 2)) + 1e-9)
    c = np.cumsum(np.concatenate([[0.0], x.astype(np.float64) ** 2]))
    return float(np.sqrt((c[n:] - c[:-n]).max() / n) + 1e-9)


def normalize(x, sr, rms_db=-12.0, peak_db=-1.0):
    x = x * (10 ** (rms_db / 20) / loudest_rms(x, sr))
    peak = np.abs(x).max() + 1e-9
    limit = 10 ** (peak_db / 20)
    return x * (limit / peak) if peak > limit else x


def write_mp3(x, sr, path):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '96k', path], input=pcm, check=True)


def write_wav(x, sr, path):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', path], input=pcm, check=True)


def build(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    report = {}
    for name, layers in SOUNDS.items():
        parts = []
        for layer in layers:
            ref, start, end, gain = layer[:4]
            delay = layer[4] if len(layer) > 4 else 0
            y = cut(decode(src_dir, ref, SR), SR, start, end)
            y = normalize(y, SR) * gain  # each layer at a common level before mixing
            parts.append(np.concatenate([np.zeros(int(delay * SR), np.float32), y]))
        mix = np.zeros(max(len(p) for p in parts), np.float32)
        for p in parts:
            mix[:len(p)] += p
        fin, fout = FADES.get(name, (0, 0))
        mix = normalize(fade(mix, SR, fin, fout), SR)
        write_mp3(mix, SR, os.path.join(out_dir, f'{name}.mp3'))
        report[name] = round(len(mix) / SR, 2)
    for name, (ref, start, end, xf) in LOOPS.items():
        x = cut(decode(src_dir, ref, LOOP_SR), LOOP_SR, start, end)
        n = int(xf * LOOP_SR)
        t = np.linspace(0, np.pi / 2, n)
        body = x[:len(x) - n].copy()
        body[:n] = x[:n] * np.sin(t) + x[len(x) - n:] * np.cos(t)  # equal-power seam
        body = body * (10 ** (-16 / 20) / (np.sqrt(np.mean(body ** 2)) + 1e-9))
        peak = np.abs(body).max()
        if peak > 0.89:
            body *= 0.89 / peak
        write_wav(body, LOOP_SR, os.path.join(out_dir, f'{name}.wav'))
        report[name] = round(len(body) / LOOP_SR, 2)

    used = sorted({l[0].split(':')[1] for ls in SOUNDS.values() for l in ls if l[0].startswith('fs:')} |
                  {v[0].split(':')[1] for v in LOOPS.values() if v[0].startswith('fs:')})
    lines = ['Sound effects of 拔爽了沒? — every source is CC0 1.0 (public domain); no attribution is required.',
             'They are cut, layered and loudness-matched by tools/sfx_build.py.', '',
             'Kenney (kenney.nl), CC0: Casino Audio, Digital Audio, Impact Sounds, Interface Sounds,',
             'Music Jingles, RPG Audio, Sci-Fi Sounds, UI Audio.', '', 'Freesound (freesound.org), CC0:']
    for sid in used:
        lines.append(f'  {sid}  {CREDITS.get(sid, "?")}  https://freesound.org/s/{sid}/')
    with open(os.path.join(out_dir, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build(sys.argv[1], os.path.join(root, 'public', 'sfx'))
