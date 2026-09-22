package com.casese.generator.plan;

import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlClass;
import com.squareup.javapoet.ClassName;
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
    /**
     * Declara su propio {@code @Id}: es la raíz de su jerarquía. Una subclase
     * no lo declara, porque en Java ya lo tiene de su padre.
     */
    boolean declaresId,
    /** Atributos que serán columnas; la clave primaria no está entre ellos. */
    List<UmlAttribute> columns,
    List<Link> links) {

  /**
   * La clave primaria de toda entidad.
   *
   * <p>No viene del diagrama: la pone el generador, siempre igual, en todas las
   * tablas. El editor no deja declararla como atributo y las importaciones la
   * descartan, de modo que aquí no hay nada que decidir —ni qué atributo es la
   * clave, ni de qué tipo, ni si la base puede autogenerarla—. Un {@code Long}
   * con {@code IDENTITY} es un {@code BIGSERIAL} en PostgreSQL.
   */
  public static final String ID_NAME = "id";

  public static final ClassName ID_TYPE = ClassName.get(Long.class);

  /**
   * El contador de versión, que tampoco viene del diagrama.
   *
   * <p>Va en todas las entidades por la misma razón que la clave primaria: no
   * es una decisión de quien dibuja, sino lo que hace falta para que dos
   * escrituras sobre el mismo registro no se pisen. JPA lo sube en cada
   * guardado y rechaza el que llegue con uno viejo.
   */
  public static final String VERSION_NAME = "version";

  public static final ClassName VERSION_TYPE = ClassName.get(Long.class);

  public String name() {
    return umlClass.name();
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
