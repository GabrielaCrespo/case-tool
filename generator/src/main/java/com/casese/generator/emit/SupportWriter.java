package com.casese.generator.emit;

import com.casese.generator.java.Names;
import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlClass;
import com.casese.generator.model.UmlMethod;
import com.casese.generator.model.UmlParameter;
import com.casese.generator.plan.Blueprint;
import com.squareup.javapoet.AnnotationSpec;
import com.squareup.javapoet.ArrayTypeName;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.FieldSpec;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.ParameterSpec;
import com.squareup.javapoet.ParameterizedTypeName;
import com.squareup.javapoet.TypeName;
import com.squareup.javapoet.TypeSpec;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.lang.model.element.Modifier;

/**
 * Lo que se genera de las clases que no son entidades: las marcadas
 * «interface», «enumeration» y «service», más la clase que arranca la
 * aplicación.
 */
final class SupportWriter {

  private static final ClassName STRING = ClassName.get(String.class);

  private final Blueprint blueprint;

  /** Donde queda la excepción de {@link #unknownReference()}, que ApiErrors atrapa. */
  private ClassName unknownReferenceType() {
    return ClassName.get(blueprint.basePackage(), "UnknownReference");
  }

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

  /**
   * «Ese registro no existe», dicho de forma que se sepa qué campo lo pedía.
   *
   * <p>Guardar una nota de venta del cliente 999 cuando no hay tal cliente es
   * un error de quien la manda, no una avería: lleva el nombre del campo encima
   * para poder contestarlo como se contesta cualquier otro campo mal puesto.
   */
  TypeSpec unknownReference() {
    return TypeSpec.classBuilder("UnknownReference")
        .addJavadoc("Generado por CASE-Tool (CU07).\n")
        .addModifiers(Modifier.PUBLIC)
        .superclass(RuntimeException.class)
        .addField(FieldSpec.builder(STRING, "field", Modifier.PRIVATE, Modifier.FINAL).build())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PUBLIC)
                .addParameter(STRING, "field")
                .addParameter(Object.class, "id")
                .addStatement(
                    "super($S + field + $S + id + $S)",
                    "El campo «",
                    "» apunta al registro ",
                    ", que no existe.")
                .addStatement("this.field = field")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("getField")
                .addModifiers(Modifier.PUBLIC)
                .returns(STRING)
                .addStatement("return this.field")
                .build())
        .build();
  }

  /**
   * El traductor de errores a respuestas HTTP.
   *
   * <p>Dos casos, y los dos importan fuera de aquí. Un cuerpo que incumple lo
   * que el diagrama marcó —un obligatorio en blanco, un texto más largo de lo
   * que cabe— sale como un 400 con el campo señalado, que es lo que el
   * formulario de la aplicación móvil pinta debajo de la casilla que falla. Y
   * una escritura sobre una versión que ya no es la última sale como un 409, que
   * es la señal con la que la aplicación detecta un conflicto al sincronizar lo
   * que se escribió sin conexión. Sin este traductor los dos serían un 500.
   */
  TypeSpec errors() {
    ParameterizedTypeName errorsByField =
        ParameterizedTypeName.get(ClassName.get(Map.class), STRING, STRING);

    return TypeSpec.classBuilder("ApiErrors")
        .addJavadoc("Generado por CASE-Tool (CU07).\n")
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REST_CONTROLLER_ADVICE)
        .addMethod(
            MethodSpec.methodBuilder("invalid")
                .addJavadoc(
                    """
                    {@code { "errors": { "campo": "mensaje" } }}: un mensaje por campo,
                    con el nombre tal como viaja en el JSON.
                    """)
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(
                    AnnotationSpec.builder(Jpa.EXCEPTION_HANDLER)
                        .addMember("value", "$T.class", Jpa.METHOD_ARGUMENT_NOT_VALID)
                        .build())
                .returns(
                    ParameterizedTypeName.get(
                        Jpa.RESPONSE_ENTITY,
                        ParameterizedTypeName.get(
                            ClassName.get(Map.class), STRING, TypeName.get(Object.class))))
                .addParameter(Jpa.METHOD_ARGUMENT_NOT_VALID, "exception")
                .addCode(
                    """
                    $T errors = new $T<>();
                    for ($T error : exception.getBindingResult().getFieldErrors()) {
                      errors.putIfAbsent(error.getField(), message(error));
                    }
                    return $T.badRequest().body($T.of($S, errors));
                    """,
                    errorsByField,
                    LinkedHashMap.class,
                    Jpa.FIELD_ERROR,
                    Jpa.RESPONSE_ENTITY,
                    Map.class,
                    "errors")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("conflict")
                .addJavadoc(
                    """
                    El registro cambió entre que el cliente lo leyó y lo guardó.
                    No se mezcla nada: se devuelve 409 y decide quien escribe.
                    """)
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(
                    AnnotationSpec.builder(Jpa.EXCEPTION_HANDLER)
                        .addMember("value", "$T.class", Jpa.OPTIMISTIC_LOCKING_FAILURE)
                        .build())
                .returns(
                    ParameterizedTypeName.get(
                        Jpa.RESPONSE_ENTITY,
                        ParameterizedTypeName.get(
                            ClassName.get(Map.class), STRING, TypeName.get(Object.class))))
                .addParameter(Jpa.OPTIMISTIC_LOCKING_FAILURE, "exception")
                .addStatement(
                    "return $T.status($T.CONFLICT).body($T.of($S, $S))",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.HTTP_STATUS,
                    Map.class,
                    "message",
                    "El registro fue modificado por otra persona; vuelva a leerlo.")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("unknownReference")
                .addJavadoc(
                    """
                    Una referencia a un registro que no existe se contesta con el mismo
                    formato que un campo mal puesto, para que el formulario que la mandó
                    la pueda señalar donde estaba.
                    """)
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(
                    AnnotationSpec.builder(Jpa.EXCEPTION_HANDLER)
                        .addMember("value", "$T.class", unknownReferenceType())
                        .build())
                .returns(
                    ParameterizedTypeName.get(
                        Jpa.RESPONSE_ENTITY,
                        ParameterizedTypeName.get(
                            ClassName.get(Map.class), STRING, TypeName.get(Object.class))))
                .addParameter(unknownReferenceType(), "exception")
                .addStatement(
                    "return $T.badRequest().body($T.of($S, $T.of(exception.getField(), $S)))",
                    Jpa.RESPONSE_ENTITY,
                    Map.class,
                    "errors",
                    Map.class,
                    "No existe el registro al que apunta.")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("integrity")
                .addJavadoc(
                    """
                    Lo que la base de datos no admite: una referencia a un registro que
                    no existe, un valor repetido en una columna única, o un borrado que
                    dejaría huérfano a otro registro.
                    """)
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(
                    AnnotationSpec.builder(Jpa.EXCEPTION_HANDLER)
                        .addMember("value", "$T.class", Jpa.DATA_INTEGRITY_VIOLATION)
                        .build())
                .returns(
                    ParameterizedTypeName.get(
                        Jpa.RESPONSE_ENTITY,
                        ParameterizedTypeName.get(
                            ClassName.get(Map.class), STRING, TypeName.get(Object.class))))
                .addParameter(Jpa.DATA_INTEGRITY_VIOLATION, "exception")
                .addStatement(
                    "return $T.status($T.CONFLICT).body($T.of($S, $S))",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.HTTP_STATUS,
                    Map.class,
                    "message",
                    "Los datos no son compatibles con lo que ya está guardado: "
                        + "revise las referencias y los valores que no pueden repetirse.")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("message")
                .addJavadoc("El texto de la restricción, o uno genérico si no lo trae.\n")
                .addModifiers(Modifier.PRIVATE, Modifier.STATIC)
                .returns(STRING)
                .addParameter(Jpa.FIELD_ERROR, "error")
                .addStatement(
                    "return error.getDefaultMessage() == null ? $S : error.getDefaultMessage()",
                    "Valor no válido.")
                .build())
        .build();
  }

  /**
   * De dónde se admiten peticiones.
   *
   * <p>Va en una variable de entorno porque el backend generado se ejecuta en
   * sitios distintos: en el portátil de quien lo descarga, donde el origen es
   * {@code localhost}, y publicado detrás del dominio de la herramienta, donde
   * es el del editor. El valor por defecto abre la puerta a cualquiera, que es
   * lo cómodo para probarlo recién descargado.
   */
  TypeSpec cors() {
    return TypeSpec.classBuilder("CorsConfiguration")
        .addJavadoc("Generado por CASE-Tool (CU07).\n")
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.CONFIGURATION)
        .addSuperinterface(Jpa.WEB_MVC_CONFIGURER)
        .addField(
            FieldSpec.builder(
                    ArrayTypeName.of(STRING), "origins", Modifier.PRIVATE, Modifier.FINAL)
                .build())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PUBLIC)
                .addParameter(
                    ParameterSpec.builder(ArrayTypeName.of(STRING), "origins")
                        .addAnnotation(
                            AnnotationSpec.builder(Jpa.VALUE)
                                .addMember("value", "$S", "${CORS_ORIGINS:*}")
                                .build())
                        .build())
                .addStatement("this.origins = origins")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("addCorsMappings")
                .addAnnotation(Override.class)
                .addModifiers(Modifier.PUBLIC)
                .addParameter(Jpa.CORS_REGISTRY, "registry")
                .addCode(
                    """
                    registry.addMapping($S)
                        .allowedOriginPatterns(this.origins)
                        .allowedMethods($S, $S, $S, $S, $S)
                        .allowedHeaders($S);
                    """,
                    "/**",
                    "GET",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "*")
                .build())
        .build();
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
