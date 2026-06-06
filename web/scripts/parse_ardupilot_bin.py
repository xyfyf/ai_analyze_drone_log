#!/usr/bin/env python3
"""ArduPilot DataFlash .bin -> 结构化 JSON。

由 Node 端 child_process.spawn 调用：
    python parse_ardupilot_bin.py <path-to.bin>

- stdout：JSON（成功）或 {"error": "..."}（失败）
- stderr：调试日志（被 Node 端忽略）

仅依赖 pymavlink；输出尽量紧凑，避免 stdout 大于必要值。
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from pymavlink.DFReader import DFReader_binary

MAX_IMU_ROWS = 120_000
MAX_OTHER_ROWS = 30_000
WANTED = {
    "IMU", "IMU2", "IMU3",
    "RCOU",
    "BAT", "BAT2",
    "ATT",
    "VIBE",
    "MODE",
    "EV",
    "PARM",
}


def get_time_us(d: dict[str, Any]) -> int:
    if "TimeUS" in d and isinstance(d["TimeUS"], (int, float)):
        return int(d["TimeUS"])
    if "TimeMS" in d and isinstance(d["TimeMS"], (int, float)):
        return int(d["TimeMS"]) * 1000
    return 0


def fnum(d: dict[str, Any], k: str, default: float = 0.0) -> float:
    v = d.get(k)
    if isinstance(v, (int, float)):
        return float(v)
    return default


def main(path: str) -> int:
    dfr = DFReader_binary(path)

    imu_rows: list[list[float]] = []
    rcou_rows: list[list[float]] = []
    bat_rows: list[list[float]] = []
    att_rows: list[list[float]] = []
    vibe_rows: list[list[float]] = []
    mode_events: list[dict[str, Any]] = []
    ev_events: list[dict[str, Any]] = []
    params: dict[str, float] = {}

    while True:
        m = dfr.recv_match(type=list(WANTED))
        if m is None:
            break
        t = m.get_type()
        d = m.to_dict()
        time_us = get_time_us(d)

        if t.startswith("IMU"):
            if len(imu_rows) < MAX_IMU_ROWS:
                imu_rows.append([
                    time_us,
                    fnum(d, "GyrX"), fnum(d, "GyrY"), fnum(d, "GyrZ"),
                    fnum(d, "AccX"), fnum(d, "AccY"), fnum(d, "AccZ"),
                ])
        elif t == "RCOU":
            if len(rcou_rows) < MAX_OTHER_ROWS:
                row = [time_us]
                for i in range(1, 9):
                    row.append(fnum(d, f"C{i}"))
                rcou_rows.append(row)
        elif t.startswith("BAT"):
            if len(bat_rows) < MAX_OTHER_ROWS:
                bat_rows.append([
                    time_us,
                    fnum(d, "Volt"), fnum(d, "Curr"),
                ])
        elif t == "ATT":
            if len(att_rows) < MAX_OTHER_ROWS:
                att_rows.append([
                    time_us,
                    fnum(d, "DesRoll"), fnum(d, "Roll"),
                    fnum(d, "DesPitch"), fnum(d, "Pitch"),
                    fnum(d, "DesYaw"), fnum(d, "Yaw"),
                    fnum(d, "ErrRP"), fnum(d, "ErrYaw"),
                ])
        elif t == "VIBE":
            if len(vibe_rows) < MAX_OTHER_ROWS:
                vibe_rows.append([
                    time_us,
                    fnum(d, "VibeX"), fnum(d, "VibeY"), fnum(d, "VibeZ"),
                    fnum(d, "Clip0"), fnum(d, "Clip1"), fnum(d, "Clip2"),
                ])
        elif t == "MODE":
            mode_events.append({
                "time_us": time_us,
                "mode": d.get("Mode"),
                "mode_num": d.get("ModeNum"),
                "reason": d.get("Rsn"),
            })
        elif t == "EV":
            ev_events.append({
                "time_us": time_us,
                "event_id": d.get("Id"),
            })
        elif t == "PARM":
            name = d.get("Name")
            val = d.get("Value")
            if isinstance(name, str) and isinstance(val, (int, float)):
                params[name] = float(val)

    att_summary = None
    if att_rows:
        n = len(att_rows)
        s_rp = s_yaw = s_roll = s_pitch = 0.0
        for r in att_rows:
            _, des_r, r_, des_p, p_, des_y, y_, err_rp, err_yaw = r
            s_rp += err_rp * err_rp
            s_yaw += err_yaw * err_yaw
            s_roll += (des_r - r_) ** 2
            s_pitch += (des_p - p_) ** 2
        att_summary = {
            "samples": n,
            "rms_err_rp_deg": (s_rp / n) ** 0.5,
            "rms_err_yaw_deg": (s_yaw / n) ** 0.5,
            "rms_err_roll_deg": (s_roll / n) ** 0.5,
            "rms_err_pitch_deg": (s_pitch / n) ** 0.5,
        }

    vibe_summary = None
    if vibe_rows:
        xs = [r[1] for r in vibe_rows]
        ys = [r[2] for r in vibe_rows]
        zs = [r[3] for r in vibe_rows]
        c0 = [r[4] for r in vibe_rows]
        c1 = [r[5] for r in vibe_rows]
        c2 = [r[6] for r in vibe_rows]
        n = len(vibe_rows)
        vibe_summary = {
            "samples": n,
            "max_vibe_x": max(xs), "mean_vibe_x": sum(xs) / n,
            "max_vibe_y": max(ys), "mean_vibe_y": sum(ys) / n,
            "max_vibe_z": max(zs), "mean_vibe_z": sum(zs) / n,
            "clip0_max": int(max(c0)), "clip1_max": int(max(c1)), "clip2_max": int(max(c2)),
        }

    sample_rate_hz = 0
    if len(imu_rows) > 100:
        diffs: list[int] = []
        n_check = min(2000, len(imu_rows))
        for i in range(1, n_check):
            dt = int(imu_rows[i][0] - imu_rows[i - 1][0])
            if 1 < dt < 100_000:
                diffs.append(dt)
        if diffs:
            diffs.sort()
            med = diffs[len(diffs) // 2]
            if med > 0:
                sample_rate_hz = round(1_000_000 / med)

    out = {
        "meta": {
            "source": "pymavlink_dfreader",
            "vehicle_type": getattr(dfr, "vehicle_type", "") or "",
            "fw_string": getattr(dfr, "fw_version_message", "") or "",
        },
        "sample_rate_hz": sample_rate_hz,
        "imu": {
            "headers": ["TimeUS", "GyrX", "GyrY", "GyrZ", "AccX", "AccY", "AccZ"],
            "data": imu_rows,
        },
        "rcou": {
            "headers": ["TimeUS"] + [f"C{i}" for i in range(1, 9)],
            "data": rcou_rows,
        },
        "bat": {
            "headers": ["TimeUS", "Volt", "Curr"],
            "data": bat_rows,
        },
        "att_summary": att_summary,
        "vibe_summary": vibe_summary,
        "mode_events": mode_events[:200],
        "ev_events": ev_events[:500],
        "params": params,
    }

    json.dump(out, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        json.dump({"error": "usage: parse_ardupilot_bin.py <path-to.bin>"}, sys.stdout)
        sys.exit(2)
    try:
        sys.exit(main(sys.argv[1]))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        json.dump({"error": f"{type(exc).__name__}: {exc}"}, sys.stdout)
        sys.exit(1)
