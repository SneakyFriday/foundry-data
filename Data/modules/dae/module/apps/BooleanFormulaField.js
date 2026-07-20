/**
 * A DataField for boolean formula strings that combine with || (OR) and && (AND) semantics
 * via Active Effect change modes, analogous to dnd5e's FormulaField for arithmetic formulas.
 */
export class BooleanFormulaField extends foundry.data.fields.StringField {
    _castChangeDelta(delta) {
        return (this._cast(delta) ?? "").trim();
    }
    // ADD → OR semantics: either condition grants the flag
    _applyChangeAdd(value, delta, model, change) {
        if (!value)
            return delta;
        return `(${value}) || (${delta})`;
    }
    // MULTIPLY → AND semantics: all conditions must be met
    _applyChangeMultiply(value, delta, model, change) {
        if (!value)
            return value;
        return `(${value}) && (${delta})`;
    }
    // UPGRADE → OR (same as ADD for booleans)
    _applyChangeUpgrade(value, delta, model, change) {
        return this._applyChangeAdd(value, delta, model, change);
    }
    // DOWNGRADE → AND (same as MULTIPLY for booleans)
    _applyChangeDowngrade(value, delta, model, change) {
        return this._applyChangeMultiply(value, delta, model, change);
    }
}
