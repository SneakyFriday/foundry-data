#!/usr/bin/env python3
from pathlib import Path
import json
from typing import Iterable

TranslationKey = str|int
TranslationKeyPath = list[TranslationKey]
TranslationValue = str
TranslationDict = dict[str, 'TranslationIntermediateValue']
TranslationList = list['TranslationIntermediateValue|None']
TranslationIntermediateValue = TranslationValue|TranslationDict|TranslationList


def pack_key_path(key_path: TranslationKeyPath) -> str:
    return '.'.join(map(lambda k: f'[{k}]' if isinstance(k, int) else k, key_path))


def unpack_key_path(s: str) -> TranslationKeyPath:
    key_path: TranslationKeyPath = []
    for key_string in s.split('.'):
        if key_string[0] == '[' and key_string[-1] == ']':
            key_index = int(key_string[1:-1])
            key_path.append(key_index)
        else:
            key_path.append(key_string)
    return key_path


def ensure_list_entry_exists[T](l: list[T|None], index: int):
    while index >= len(l):
        l.append(None)


def make_intermediate_key_value(key: TranslationKey) -> TranslationDict|TranslationList:
    if isinstance(key, str):
        return {}
    elif isinstance(key, int):
        return []
    else:
        raise RuntimeError('Not supported')


def get_or_create_key_parent(parent: TranslationDict|TranslationList, key_path: TranslationKeyPath) -> TranslationDict|TranslationList:
    if len(key_path) <= 1:
        return parent
    key = key_path[0]
    child_key = key_path[1]
    child: TranslationIntermediateValue|None
    if isinstance(parent, dict):
        assert isinstance(key, str)
        child = parent.get(key)
        if child is None:
            child = make_intermediate_key_value(child_key)
            parent[key] = child
    elif isinstance(parent, list):
        assert isinstance(key, int)
        ensure_list_entry_exists(parent, key)
        child = parent[key]
        if child is None:
            child = make_intermediate_key_value(child_key)
            parent[key] = child
    else:
        raise RuntimeError('Unknown key data type')
    if isinstance(child, str):
        breakpoint()
    assert not isinstance(child, str)
    return get_or_create_key_parent(child, key_path[1:])


def set_item(root: TranslationDict, key_path: TranslationKeyPath, value: TranslationValue):
    parent = get_or_create_key_parent(root, key_path)
    last_key = key_path[-1]
    if isinstance(last_key, str):
        assert isinstance(parent, dict)
        if last_key in parent:
            raise RuntimeError(f'{pack_key_path(key_path)} is assigned multiple times')
        parent[last_key] = value
    elif isinstance(last_key, int):
        assert isinstance(parent, list)
        ensure_list_entry_exists(parent, last_key)
        if parent[last_key] is not None:
            raise RuntimeError(f'{pack_key_path(key_path)} is assigned multiple times')
        parent[last_key] = value
    else:
        raise RuntimeError('Unexpected key data type')


def get_all_items(container: TranslationDict|TranslationList, parent_key_path: TranslationKeyPath = []) -> Iterable[tuple[TranslationKeyPath, TranslationValue]]:
    container_items: Iterable[tuple[TranslationKeyPath, TranslationIntermediateValue]]
    key_path: TranslationKeyPath

    if isinstance(container, dict):
        container_items = map(lambda t: (unpack_key_path(t[0]), t[1]), container.items())
    elif isinstance(container, list):
        def map_list_items(t: tuple[int, TranslationIntermediateValue|None]) -> tuple[TranslationKeyPath, TranslationIntermediateValue]:
            assert t[1] is not None
            return ([t[0]], t[1])
        container_items = map(map_list_items, enumerate(container))
    else:
        raise RuntimeError('Unexpected container type')

    for sub_key_path, value in container_items:
        key_path = [*parent_key_path, *sub_key_path]
        if isinstance(value, str):
            yield (key_path, value)
        elif isinstance(value, dict) or isinstance(value, list):
            yield from get_all_items(value, key_path)
        else:
            raise RuntimeError(f'Unsupported value at {pack_key_path(key_path)}')


def rebuild_translation_nested(keys: TranslationDict) -> TranslationDict:
    new_keys: TranslationDict = {}
    for key_path, value in get_all_items(keys):
        set_item(new_keys, key_path, value)
    return new_keys


def rebuild_translation_flat(keys: TranslationDict) -> TranslationDict:
    new_keys: TranslationDict = {}
    for key_path, value in get_all_items(keys):
        new_keys[pack_key_path(key_path)] = value
    return new_keys


def rewrite_file(filename: Path):
    with filename.open() as file:
        keys = json.load(file)
    new_keys = rebuild_translation_nested(keys)
    with filename.open(mode='w') as file:
        json.dump(new_keys, file,
                  indent=2,
                  sort_keys=True)


if __name__ == '__main__':
    project_root = Path(__file__).parent.parent
    for json_file in (project_root/'translations').glob('**/*.json'):
        print(f'Rewriting {json_file.relative_to(project_root)} …')
        rewrite_file(json_file)
