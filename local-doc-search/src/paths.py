"""
Path management for FinderSemanticSearch data storage.
Centralizes all path logic to use proper macOS Application Support directories.
"""
from pathlib import Path
import os


def get_app_support_dir() -> Path:
    """Get Application Support directory for the app"""
    home = Path.home()
    app_support = home / "Library" / "Application Support" / "FinderSemanticSearch"
    app_support.mkdir(parents=True, exist_ok=True)
    return app_support


def get_data_dir() -> Path:
    """Get data directory for persistent storage"""
    data_dir = get_app_support_dir() / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_index_dir() -> Path:
    """Get index directory"""
    index_dir = get_data_dir() / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    return index_dir


def get_embeddings_cache_dir() -> Path:
    """Get embeddings cache directory"""
    cache_dir = get_data_dir() / "embeddings_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_config_path() -> Path:
    """Get user config file path"""
    return get_app_support_dir() / "config.yaml"


def get_cache_dir() -> Path:
    """Get cache directory for downloadable content"""
    home = Path.home()
    cache = home / "Library" / "Caches" / "FinderSemanticSearch"
    cache.mkdir(parents=True, exist_ok=True)
    return cache


def get_models_cache_dir() -> Path:
    """Get directory for cached ML models"""
    models_dir = get_cache_dir() / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir