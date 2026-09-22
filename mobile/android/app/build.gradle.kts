plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.casetool.mobile"
    compileSdk = flutter.compileSdkVersion
    // Sin ndkVersion a propósito: ninguna de las dependencias compila código
    // nativo desde el fuente —todas traen sus binarios ya hechos—, y pedir el
    // NDK obligaría a descargar dos gigas para no usarlos.

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.casetool.mobile"
        // 26 y no el mínimo que trae Flutter: es lo que pide MediaPipe, que es
        // sobre lo que corre el modelo de lenguaje del teléfono (CU09).
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Se firma con la clave de depuración. Vale para instalarlo a mano
            // en un teléfono, que es para lo que se usa; publicarlo en Play
            // pediría una clave propia.
            signingConfig = signingConfigs.getByName("debug")

            // R8 se planta si alguna librería nombra clases que no están, y
            // flutter_gemma y OkHttp nombran unas cuantas a propósito. Las
            // reglas explican cuáles y por qué.
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
