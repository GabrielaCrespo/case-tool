package com.casese.generator.plan;

import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlClass;
import com.squareup.javapoet.TypeName;
import java.util.List;

/** Todo lo que hace falta saber de una clase para escribir sus cuatro capas. */
public record EntityPlan(
    UmlClass umlClass,
    /** De quién hereda, o {@code null} si no hereda de nadie. */
    UmlClass parent,
    /** Interfaces que realiza. */
    List<UmlClass> interfaces,
    /** Alguien hereda de ella: necesita declarar la estrategia de herencia. */
    boolean hasChildren,
    /** Su clave primaria, o {@code null} cuando la hereda de su padre. */
    Id id,
    /** Atributos que serán columnas, ya sin la clave primaria. */
    List<UmlAttribute> columns,
    List<Link> links) {

  /**
   * La clave primaria de la entidad.
   *
   * <p>Cuando el diagrama no marca ninguna se inventa un {@code Long id}
   * autogenerado. Una tabla sin clave primaria no es una tabla, y una clase
   * dibujada sin ella casi siempre es una clase a la que todavía no se le puso,
   * no una que no la quiera.
   */
  public record Id(String name, TypeName type, boolean generated, boolean synthetic) {}

  public String name() {
    return umlClass.name();
  }

  /** La clase declara su propio {@code @Id}: es la raíz de su jerarquía. */
  public boolean declaresId() {
    return id != null;
  }

  public boolean isAbstract() {
    return umlClass.isAbstract();
  }

  /**
   * Las capas de acceso sólo se generan para clases instanciables. Una clase
   * abstracta no se puede guardar ni crear desde un controlador, así que
   * tendría un repositorio que nadie podría usar.
   */
  public boolean needsCrud() {
    return !isAbstract();
  }
}
