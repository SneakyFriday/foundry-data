
export const defaultMappings = {
    "Adventure": {
        "name": "name",
        "description": "description",
        "caption": "caption",
        "folders": {
            "path": "folders",
            "converter": "nameCollection"
        },
        "journals": {
            "path": "journal",
            "converter": "document",
            "documentType": "JournalEntry",
            "cardinality": "many"
        },
        "scenes": {
            "path": "scenes",
            "converter": "document",
            "documentType": "Scene",
            "cardinality": "many"
        },
        "macros": {
            "path": "macros",
            "converter": "document",
            "documentType": "Macro",
            "cardinality": "many"
        },
        "playlists": {
            "path": "playlists",
            "converter": "document",
            "documentType": "Playlist",
            "cardinality": "many"
        },
        "tables": {
            "path": "tables",
            "converter": "document",
            "documentType": "RollTable",
            "cardinality": "many"
        },
        "items": {
            "path": "items",
            "converter": "document",
            "documentType": "Item",
            "cardinality": "many"
        },
        "actors": {
            "path": "actors",
            "converter": "document",
            "documentType": "Actor",
            "cardinality": "many"
        },
        "cards": {
            "path": "cards",
            "converter": "document",
            "documentType": "Cards",
            "cardinality": "many"
        }
    },
    "Actor": {
        "name": "name",
        "description": "system.details.biography.value",
        "items": {
            "path": "items",
            "converter": "document",
            "documentType": "Item",
            "cardinality": "many"
        },
        "effects": {
            "path": "effects",
            "converter": "document",
            "documentType": "ActiveEffect",
            "cardinality": "many"
        },
        "tokenName": {
            "path": "prototypeToken.name",
            "converter": "name"
        }
    },
    "ActiveEffect": {
        "name": "name",
        "description": "description",
        "changes": {
            "path": "changes",
            "converter": "structured",
            "cardinality": "many",
            "container": "array",
            "key": "key",
            "valuePath": "value"
        }
    },
    "Cards": {
        "name": "name",
        "description": "description",
        "cards": {
            "path": "cards",
            "converter": "document",
            "documentType": "Card",
            "cardinality": "many"
        }
    },
    "Card": {
        "name": "name",
        "description": "description",
        "suit": "suit",
        "faces": {
            "path": "faces",
            "converter": "structured",
            "cardinality": "many",
            "compact": true,
            "mapping": {
                "img": "img",
                "name": "name",
                "text": "text"
            }
        },
        "back": {
            "path": "back",
            "converter": "structured",
            "cardinality": "one",
            "mapping": {
                "img": "img",
                "name": "name",
                "text": "text"
            }
        }
    },
    "Folder": {},
    "Item": {
        "name": "name",
        "description": "system.description.value",
        "effects": {
            "path": "effects",
            "converter": "document",
            "documentType": "ActiveEffect",
            "cardinality": "many"
        }
    },
    "JournalEntry": {
        "name": "name",
        "description": "content",
        "categories": {
            "path": "categories",
            "converter": "nameCollection"
        },
        "pages": {
            "path": "pages",
            "converter": "document",
            "documentType": "JournalEntryPage",
            "cardinality": "many"
        }
    },
    "JournalEntryPage": {
        "name": "name",
        "caption": "image.caption",
        "src": "src",
        "text": "text.content",
        "width": "video.width",
        "height": "video.height"
    },
    "Macro": {
        "name": "name",
        "command": "command"
    },
    "Playlist": {
        "name": "name",
        "description": "description",
        "sounds": {
            "path": "sounds",
            "converter": "document",
            "documentType": "PlaylistSound",
            "cardinality": "many"
        }
    },
    "PlaylistSound": {
        "name": "name",
        "description": "description"
    },
    "RollTable": {
        "name": "name",
        "description": "description",
        "results": {
            "path": "results",
            "converter": "document",
            "documentType": "TableResult",
            "cardinality": "many"
        }
    },
    "TableResult": {
        "_identity": {
            "export": ["range", "_id"],
            "match": ["_id", "range"]
        },
        "name": {
            "path": "name",
            "converter": "referencedDocumentField",
            "uuidPath": "documentUuid",
            "referencedField": "name"
        },
        "description": "description"
    },
    "Scene": {
        "name": "name",
        "drawings": {
            "path": "drawings",
            "converter": "textCollection"
        },
        "notes": {
            "path": "notes",
            "converter": "textCollection"
        },
        "regions": {
            "path": "regions",
            "converter": "document",
            "documentType": "Region",
            "cardinality": "many"
        }
    },
    "Region": {
        "name": "name",
        "behaviors": {
            "path": "behaviors",
            "converter": "document",
            "documentType": "RegionBehavior",
            "cardinality": "many"
        }
    },
    "RegionBehavior": {
        "name": "name",
        "_variants": [{
                "_when": { "path": "type", "equals": "displayScrollingText" },
                "text": "system.text"
            }, {
                "_when": { "path": "type", "equals": "teleportToken" },
                "revealedDialog": "system.dialog.revealed",
                "unrevealedDialog": "system.dialog.unrevealed"
            }
        ]
    }
}
