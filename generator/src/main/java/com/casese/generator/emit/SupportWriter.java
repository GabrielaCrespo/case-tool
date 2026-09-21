package com.casese.generator.emit;

import com.casese.generator.java.Names;
import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlClass;
import com.casese.generator.model.UmlMethod;
import com.casese.generator.model.UmlParameter;
import com.casese.generator.plan.Blueprint;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.TypeSpec;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import javax.lang.model.element.Modifier;

/**
 * Lo que se genera de las clases que no son entidades: las marcadas
 * «interface», «enumeration» y «service», más la clase que arranca la
 * aplicación.
 */
final class SupportWriter {

  private final Blueprint blueprint;

  SupportWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  /** Una clase «interface» del diagrama es una interfaz Java con sus firmas. */
  TypeSpec anInterface(UmlClass umlClass) {
    TypeSpec.Builder type =
        TypeSpec.interfaceBuilder(Names.pascal(umlClass.name()))
            .addJavadoc(
                "Generado por CASE-Tool (CU07) a partir de la interfaz UML «$L».\n",
                umlClass.name())
            .addModifiers(Modifier.PUBLIC);

    for (UmlMethod method : umlClass.methods()) {
      MethodSpec.Builder builder =
          MethodSpec.methodBuilder(method.name())
              .addModifiers(Modifier.PUBLIC, Modifier.ABSTRACT)
              .returns(blueprint.resolve(method.returnType()));

      for (UmlParameter parameter : method.parameters()) {
        builder.addParameter(blueprint.resolve(parameter.dataType()), parameter.name());
      }
      type.addMethod(builder.build());
    }
    return type.build();
  }

  /**
   * Una clase «enumeration» se convierte en un enum cuyos valores son los
   * nombres de sus atributos: es como se dibuja un enumerado en un diagrama de
   * clases, listando los valores dentro de la caja.
   */
  TypeSpec anEnum(UmlClass umlClass) {
    TypeSpec.Builder type =
        TypeSpec.enumBuilder(Names.pascal(umlClass.name()))
            .addJavadoc(
                "Generado por CASE-Tool (CU07) a partir del enumerado UML «$L».\n",
                umlClass.name())
            .addModifiers(Modifier.PUBLIC);

    Set<String> constants = new LinkedHashSet<>();
    for (UmlAttribute attribute : umlClass.attributes()) {
      constants.add(Names.snake(attribute.name()).toUpperCase(Locale.ROOT));
    }

    // Un enum vacío compila pero no sirve de nada; se deja constancia.
    if (constants.isEmpty()) {
      type.addJavadoc("\nEl enumerado no tenía valores en el diagrama.\n");
      type.addEnumConstant("SIN_VALORES");
    }
    constants.forEach(type::addEnumConstant);

    return type.build();
  }

  /** Una clase «service» se genera tal cual, sin entidad ni repositorio detrás. */
  TypeSpec standaloneService(UmlClass umlClass) {
    TypeSpec.Builder type =
        TypeSpec.classBuilder(Names.pascal(umlClass.name()))
            .addJavadoc(
                "Generado por CASE-Tool (CU07) a partir del servicio UML «$L».\n",
                umlClass.name())
            .addModifiers(Modifier.PUBLIC)
            .addAnnotation(Jpa.SERVICE_ANNOTATION);

    for (UmlMethod method : umlClass.methods()) {
      MethodSpec.Builder builder =
          MethodSpec.methodBuilder(method.name())
              .addModifiers(Modifier.PUBLIC)
              .returns(blueprint.resolve(method.returnType()));

      for (UmlParameter parameter : method.parameters()) {
        builder.addParameter(blueprint.resolve(parameter.dataType()), parameter.name());
      }
      builder.addStatement(
          "throw new $T($S)",
          UnsupportedOperationException.class,
          "Operación «" + method.name() + "» declarada en el diagrama y aún sin implementar.");

      type.addMethod(builder.build());
    }
    return type.build();
  }

  /** El punto de entrada del proyecto generado. */
  TypeSpec application() {
    return TypeSpec.classBuilder("Application")
        .addJavadoc(
            "Backend generado por CASE-Tool (CU07) a partir del diagrama «$L».\n",
            blueprint.model().name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.SPRING_BOOT_APPLICATION)
        .addMethod(
            MethodSpec.methodBuilder("main")
                .addModifiers(Modifier.PUBLIC, Modifier.STATIC)
                .addParameter(String[].class, "args")
                .addStatement("$T.run(Application.class, args)", Jpa.SPRING_APPLICATION)
                .build())
        .build();
  }
}
