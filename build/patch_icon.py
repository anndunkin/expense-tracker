#!/usr/bin/env python3
"""
Patch the icon into the Expense Track.exe PE binary using pefile.
Replaces RT_ICON resources with data from icon.ico.
"""
import struct
import sys
import os
import shutil

try:
    import pefile
except ImportError:
    os.system("pip install pefile -q")
    import pefile

EXE = "/home/user/workspace/expense-tracker/dist-electron/win-unpacked/Expense Track.exe"
ICO = "/home/user/workspace/expense-tracker/electron/icon.ico"

def read_ico_images(ico_path):
    """Parse an .ico file and return list of (width, data) tuples."""
    with open(ico_path, "rb") as f:
        data = f.read()
    reserved, img_type, count = struct.unpack_from("<HHH", data, 0)
    images = []
    for i in range(count):
        offset = 6 + i * 16
        width, height, color_count, reserved2, planes, bit_count, img_size, img_offset = \
            struct.unpack_from("<BBBBHHII", data, offset)
        actual_width = width if width != 0 else 256
        img_data = data[img_offset:img_offset + img_size]
        images.append((actual_width, bytes(img_data)))
    images.sort(key=lambda x: x[0], reverse=True)
    return images

def patch_icons():
    print(f"Loading PE: {EXE}")
    # Load into memory as a mutable bytearray
    with open(EXE, "rb") as f:
        raw = bytearray(f.read())
    
    pe = pefile.PE(data=bytes(raw))

    ico_images = read_ico_images(ICO)
    print(f"ICO has {len(ico_images)} images: {[img[0] for img in ico_images]}")

    # Find RT_ICON entries
    RT_ICON = 3
    icon_entries = []
    for rsrc_type in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if rsrc_type.id == RT_ICON:
            for rsrc_id in rsrc_type.directory.entries:
                for rsrc_lang in rsrc_id.directory.entries:
                    offset = rsrc_lang.data.struct.OffsetToData
                    size = rsrc_lang.data.struct.Size
                    icon_entries.append((rsrc_id.id, offset, size, rsrc_lang.data.struct))
            break

    # Sort entries by size descending to match ico_images order
    icon_entries.sort(key=lambda x: x[2], reverse=True)
    print(f"PE has {len(icon_entries)} RT_ICON entries (sorted by size desc)")

    patched = 0
    pair_count = min(len(icon_entries), len(ico_images))
    for i in range(pair_count):
        entry_id, offset, size, struct_ref = icon_entries[i]
        ico_width, ico_data = ico_images[i]
        new_size = len(ico_data)
        
        # Write ico_data into the raw buffer, padded/truncated to fit the slot
        if new_size <= size:
            raw[offset:offset + new_size] = ico_data
            # Zero remaining bytes in the slot
            if new_size < size:
                raw[offset + new_size:offset + size] = bytes(size - new_size)
            patched += 1
            print(f"  Patched icon entry {entry_id} ({ico_width}px): {size} -> {new_size} bytes @ offset {offset:#x}")
        else:
            # New data is larger than slot — truncate to fit (PE resource size wins)
            raw[offset:offset + size] = ico_data[:size]
            patched += 1
            print(f"  Patched (truncated) icon entry {entry_id} ({ico_width}px): {size} bytes (ico was {new_size}) @ offset {offset:#x}")

    pe.close()

    print(f"Writing patched EXE ({patched} icons patched)...")
    with open(EXE, "wb") as f:
        f.write(raw)
    print("Done.")

if __name__ == "__main__":
    patch_icons()
