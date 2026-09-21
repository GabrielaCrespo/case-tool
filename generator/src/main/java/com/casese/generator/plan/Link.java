package com.casese.generator.plan;

import com.casese.generator.model.UmlClass;
import com.casese.generator.model.UmlRelationship;

/**
 * Un campo con anotación JPA que una entidad gana por estar relacionada con
 * otra. Cada relación del diagrama produce como mucho dos: el del lado
 * propietario, que es quien lleva la clave foránea o la tabla intermedia, y el
 * del lado inverso, que sólo sirve para poder navegar de vuelta.
 */
public record Link(
    Kind kind,
    /** Nombre del campo en la clase que lo declara. */
    String field,
    /** La clase del otro extremo. */
    UmlClass other,
    /** Lado inverso: el campo del propietario que manda. */
    String mappedBy,
    /** Lado propietario de un @ManyToOne o un @OneToOne: su columna. */
    String joinColumn,
    /** Propietario de un @ManyToMany: la tabla intermedia y sus dos columnas. */
    String joinTable,
    String joinColumnHere,
    String joinColumnThere,
    /** Composición: las partes se guardan y se borran con el todo. */
    boolean cascade,
    UmlRelationship origin) {

  public enum Kind {
    MANY_TO_ONE,
    ONE_TO_MANY,
    ONE_TO_ONE_OWNER,
    ONE_TO_ONE_INVERSE,
    MANY_TO_MANY_OWNER,
    MANY_TO_MANY_INVERSE
  }

  /** El campo es una colección y no una referencia suelta. */
  public boolean isCollection() {
    return kind == Kind.ONE_TO_MANY
        || kind == Kind.MANY_TO_MANY_OWNER
        || kind == Kind.MANY_TO_MANY_INVERSE;
  }

  /**
   * El lado que manda en la base de datos. Se genera siempre, aunque el
   * diagrama diga que por ahí no se navega: sin él no habría clave foránea y la
   * relación desaparecería de las tablas.
   */
  public boolean isOwner() {
    return mappedBy == null;
  }
}
