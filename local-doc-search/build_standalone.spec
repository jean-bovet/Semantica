# -*- mode: python ; coding: utf-8 -*-

import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

# Collect all data files and hidden imports for sentence-transformers and related packages
datas = []
hiddenimports = []
binaries = []

# Sentence transformers and related packages
packages_to_collect = [
    'sentence_transformers',
    'transformers',
    'torch',
    'numpy',
    'faiss',
    'pypdf',
    'python-docx',
    'chardet',
    'tqdm',
    'huggingface_hub',
    'safetensors',
    'tokenizers',
    'regex',
    'requests',
    'filelock',
    'pyyaml',
]

for package in packages_to_collect:
    try:
        tmp_datas, tmp_binaries, tmp_hiddenimports = collect_all(package)
        datas += tmp_datas
        binaries += tmp_binaries
        hiddenimports += tmp_hiddenimports
    except:
        # Package might not need special collection
        hiddenimports.append(package)

# Add specific hidden imports that might be missed
hiddenimports += [
    'sklearn.utils._typedefs',
    'sklearn.neighbors._partition_nodes',
    'scipy.special._ufuncs_cxx',
    'scipy._lib.messagestream',
    'torch._C',
    'torch._C._nn',
    'torch._C._fft',
    'torch._C._linalg',
    'torch._C._nested',
    'torch._C._sparse',
    'torch._C._special',
]

# Add our own source files
datas += [
    ('src', 'src'),
    ('config.yaml', '.'),
]

a = Analysis(
    ['cli_standalone.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='search-cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)