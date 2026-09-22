package com.casese.generator.emit;

import com.casese.generator.java.Names;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.casese.generator.plan.Link;
import com.squareup.javapoet.AnnotationSpec;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.CodeBlock;
import com.squareup.javapoet.FieldSpec;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.ParameterSpec;
import com.squareup.javapoet.ParameterizedTypeName;
import com.squareup.javapoet.TypeName;
import com.squareup.javapoet.TypeSpec;
import com.squareup.javapoet.TypeVariableName;
import java.util.List;
import java.util.Optional;
import javax.lang.model.element.Modifier;

/**
 * Las tres capas de acceso de una entidad: repositorio, servicio y controlador.
 *
 * <p>Están juntas porque son una sola decisión: el CRUD que toda entidad tiene
 * por el hecho de serlo. Lo que el diagrama añade por encima de eso son las
 * operaciones declaradas en la clase, que se escriben en la propia entidad.
 */
final class CrudWriter {

  private final Blueprint blueprint;

  CrudWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  /** {@code interface ClienteRepository extends JpaRepository<Cliente, Long>}. */
  TypeSpec repository(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    TypeName id = EntityPlan.ID_TYPE;

    return TypeSpec.interfaceBuilder(blueprint.repositoryType(plan.umlClass()).simpleName())
        .addJavadoc("Acceso a datos de $L. Spring Data implementa esta interfaz.\n", plan.name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REPOSITORY_ANNOTATION)
        .addSuperinterface(ParameterizedTypeName.get(Jpa.JPA_REPOSITORY, entity, id.box()))
        .build();
  }

  TypeSpec service(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    ClassName repository = blueprint.repositoryType(plan.umlClass());
    TypeName idType = EntityPlan.ID_TYPE;

    String variable = Names.camel(entity.simpleName());
    TypeName listOfEntity = ParameterizedTypeName.get(ClassName.get(List.class), entity);
    TypeName optionalOfEntity = ParameterizedTypeName.get(ClassName.get(Optional.class), entity);

    List<Link> references = referencesOf(plan);

    TypeSpec.Builder type =
        TypeSpec.classBuilder(blueprint.serviceType(plan.umlClass()).simpleName())
            .addJavadoc("Reglas de negocio de $L.\n", plan.name())
            .addModifiers(Modifier.PUBLIC)
            .addAnnotation(Jpa.SERVICE_ANNOTATION)
            .addAnnotation(Jpa.TRANSACTIONAL)
            .addField(
                FieldSpec.builder(repository, "repository", Modifier.PRIVATE, Modifier.FINAL)
                    .build());

    MethodSpec.Builder constructor =
        MethodSpec.constructorBuilder()
            .addModifiers(Modifier.PUBLIC)
            .addParameter(repository, "repository")
            .addStatement("this.repository = repository");

    if (!references.isEmpty()) {
      type.addField(
          FieldSpec.builder(
                  Jpa.ENTITY_MANAGER, "entityManager", Modifier.PRIVATE, Modifier.FINAL)
              .addJavadoc("Para cambiar las referencias que llegan por su versión buena.\n")
              .build());
      constructor
          .addParameter(Jpa.ENTITY_MANAGER, "entityManager")
          .addStatement("this.entityManager = entityManager");
    }

    return type.addMethod(constructor.build())
        .addMethods(resolvers(plan, entity, variable, references))
        .addMethod(
            MethodSpec.methodBuilder("findAll")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(readOnly())
                .returns(listOfEntity)
                .addStatement("return this.repository.findAll()")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findById")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(readOnly())
                .returns(optionalOfEntity)
                .addParameter(idType, "id")
                .addStatement("return this.repository.findById(id)")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("create")
                .addModifiers(Modifier.PUBLIC)
                .returns(entity)
                .addParameter(entity, variable)
                .addCode(resolveCall(variable, references))
                .addStatement("return this.repository.save($L)", variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("update")
                .addModifiers(Modifier.PUBLIC)
                .returns(optionalOfEntity)
                .addParameter(idType, "id")
                .addParameter(entity, variable)
                .addJavadoc(
                    """
                    Vacío si no existe: es lo que el controlador traduce a 404.

                    <p>Si el cuerpo trae la versión que leyó el cliente y entretanto
                    alguien guardó el registro, JPA rechaza la escritura y la petición
                    acaba en 409. Si no la trae, se toma la que hay guardada y gana el
                    último que escribe.
                    """)
                .addCode(
                    """
                    $T<$T> guardado = this.repository.findById(id);
                    if (guardado.isEmpty()) {
                      return $T.empty();
                    }
                    """,
                    Optional.class,
                    entity,
                    Optional.class)
                // El identificador manda el de la ruta, no el del cuerpo: así
                // un PUT no puede mover el registro a otro id.
                .addStatement("$L.$L(id)", variable, Names.accessor("set", EntityPlan.ID_NAME))
                .addCode(
                    """
                    if ($L.$L() == null) {
                      $L.$L(guardado.get().$L());
                    }
                    """,
                    variable,
                    Names.accessor("get", EntityPlan.VERSION_NAME),
                    variable,
                    Names.accessor("set", EntityPlan.VERSION_NAME),
                    Names.accessor("get", EntityPlan.VERSION_NAME))
                .addCode(resolveCall(variable, references))
                .addStatement("return $T.of(this.repository.save($L))", Optional.class, variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("delete")
                .addModifiers(Modifier.PUBLIC)
                .returns(TypeName.BOOLEAN)
                .addParameter(idType, "id")
                .addCode(
                    """
                    if (!this.repository.existsById(id)) {
                      return false;
                    }
                    """)
                .addStatement("this.repository.deleteById(id)")
                .addStatement("return true")
                .build())
        .build();
  }

  TypeSpec controller(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    ClassName service = blueprint.serviceType(plan.umlClass());
    TypeName idType = EntityPlan.ID_TYPE;

    String variable = Names.camel(entity.simpleName());
    TypeName listOfEntity = ParameterizedTypeName.get(ClassName.get(List.class), entity);
    TypeName responseOfEntity = ParameterizedTypeName.get(Jpa.RESPONSE_ENTITY, entity);
    TypeName responseOfVoid =
        ParameterizedTypeName.get(Jpa.RESPONSE_ENTITY, ClassName.get(Void.class));

    return TypeSpec.classBuilder(blueprint.controllerType(plan.umlClass()).simpleName())
        .addJavadoc("API REST de $L.\n", plan.name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REST_CONTROLLER)
        .addAnnotation(
            AnnotationSpec.builder(Jpa.REQUEST_MAPPING)
                .addMember("value", "$S", Names.restPath(plan.name()))
                .build())
        .addField(FieldSpec.builder(service, "service", Modifier.PRIVATE, Modifier.FINAL).build())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PUBLIC)
                .addParameter(service, "service")
                .addStatement("this.service = service")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findAll")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(Jpa.GET_MAPPING)
                .returns(listOfEntity)
                .addStatement("return this.service.findAll()")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findById")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.GET_MAPPING, "/{id}"))
                .returns(responseOfEntity)
                .addParameter(pathVariable(idType))
                .addStatement(
                    "return this.service.findById(id).map($T::ok)"
                        + ".orElseGet(() -> $T.notFound().build())",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("create")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(Jpa.POST_MAPPING)
                .returns(responseOfEntity)
                .addParameter(requestBody(entity, variable))
                .addStatement(
                    "return $T.status($T.CREATED).body(this.service.create($L))",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.HTTP_STATUS,
                    variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("update")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.PUT_MAPPING, "/{id}"))
                .returns(responseOfEntity)
                .addParameter(pathVariable(idType))
                .addParameter(requestBody(entity, variable))
                .addStatement(
                    "return this.service.update(id, $L).map($T::ok)"
                        + ".orElseGet(() -> $T.notFound().build())",
                    variable,
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("delete")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.DELETE_MAPPING, "/{id}"))
                .returns(responseOfVoid)
                .addParameter(pathVariable(idType))
                .addStatement(
                    "return this.service.delete(id) ? $T.noContent().build()"
                        + " : $T.notFound().build()",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .build();
  }

  /**
   * Las relaciones que llegan dentro del cuerpo de la petición: las que este
   * lado guarda como una referencia y no como una colección.
   */
  private static List<Link> referencesOf(EntityPlan plan) {
    return plan.links().stream()
        .filter(link -> !link.isCollection() && link.isOwner())
        .toList();
  }

  /**
   * Cambia cada referencia que llegó en el JSON por la que maneja JPA.
   *
   * <p>Un cuerpo que dice {@code "cliente": {"id": 3}} no trae un Cliente: trae
   * la intención de apuntar al Cliente 3. Lo que Jackson construye con eso es un
   * objeto suelto, con su identificador puesto y todo lo demás vacío —la versión
   * incluida—, y guardarlo tal cual haría dos cosas malas: Hibernate rechaza una
   * referencia desligada sin versión, y si la aceptara escribiría los campos
   * vacíos encima del Cliente 3. Así que del objeto que llega sólo se mira el
   * identificador y se pone en su lugar la entidad de verdad.
   *
   * <p>Si el identificador no corresponde a nada, se dice ahí mismo y con el
   * nombre del campo que lo traía, que es lo que el formulario necesita para
   * señalar la casilla equivocada en vez de enseñar un error suelto.
   */
  private List<MethodSpec> resolvers(
      EntityPlan plan, ClassName entity, String variable, List<Link> references) {

    if (references.isEmpty()) {
      return List.of();
    }

    MethodSpec.Builder resolve =
        MethodSpec.methodBuilder("resolveReferences")
            .addJavadoc(
                "Deja $L con las referencias que JPA sabe guardar.\n", Names.pascal(plan.name()))
            .addModifiers(Modifier.PRIVATE)
            .addParameter(entity, variable);

    for (Link link : references) {
      ClassName other = blueprint.entityType(link.other());
      String getter = Names.accessor("get", link.field());
      String setter = Names.accessor("set", link.field());

      resolve.addStatement(
          "$L.$L(reference($T.class, $L.$L(), $S))",
          variable,
          setter,
          other,
          variable,
          getter,
          Names.jsonProperty(link.field()));
    }

    MethodSpec reference =
        MethodSpec.methodBuilder("reference")
            .addJavadoc(
                """
                La entidad guardada que corresponde a la referencia que llegó.

                <p>Se busca de verdad, y no se devuelve un apuntador perezoso, por dos
                razones: así se sabe en el acto si el identificador existe, y así la
                respuesta se puede escribir cuando la transacción ya se cerró.
                """)
            .addModifiers(Modifier.PRIVATE)
            .addTypeVariable(TypeVariableName.get("T"))
            .returns(TypeVariableName.get("T"))
            .addParameter(
                ParameterizedTypeName.get(ClassName.get(Class.class), TypeVariableName.get("T")),
                "type")
            .addParameter(TypeVariableName.get("T"), "incoming")
            .addParameter(ClassName.get(String.class), "field")
            .addCode(
                """
                if (incoming == null) {
                  return null;
                }
                $T id = this.entityManager.getEntityManagerFactory()
                    .getPersistenceUnitUtil()
                    .getIdentifier(incoming);
                if (id == null) {
                  return null;
                }
                $T found = this.entityManager.find(type, id);
                if (found == null) {
                  throw new $T(field, id);
                }
                return found;
                """,
                Object.class,
                TypeVariableName.get("T"),
                unknownReferenceType())
            .build();

    return List.of(resolve.build(), reference);
  }

  /** La excepción que escribe {@link SupportWriter#unknownReference()}. */
  private ClassName unknownReferenceType() {
    return ClassName.get(blueprint.basePackage(), "UnknownReference");
  }

  /** La llamada a {@code resolveReferences}, o nada si no hay referencias. */
  private static CodeBlock resolveCall(String variable, List<Link> references) {
    return references.isEmpty()
        ? CodeBlock.of("")
        : CodeBlock.of("resolveReferences($L);\n", variable);
  }

  private static AnnotationSpec readOnly() {
    return AnnotationSpec.builder(Jpa.TRANSACTIONAL).addMember("readOnly", "$L", true).build();
  }

  private static AnnotationSpec mapping(ClassName annotation, String path) {
    return AnnotationSpec.builder(annotation).addMember("value", "$S", path).build();
  }

  private static ParameterSpec pathVariable(TypeName idType) {
    return ParameterSpec.builder(idType, "id").addAnnotation(Jpa.PATH_VARIABLE).build();
  }

  /**
   * El cuerpo de un POST o un PUT, comprobado contra las restricciones del
   * diagrama antes de entrar al servicio. Sin {@code @Valid} las anotaciones de
   * la entidad no se miran y un obligatorio en blanco llegaría hasta
   * PostgreSQL.
   */
  private static ParameterSpec requestBody(TypeName type, String name) {
    return ParameterSpec.builder(type, name)
        .addAnnotation(Jpa.VALID)
        .addAnnotation(Jpa.REQUEST_BODY)
        .build();
  }
}
